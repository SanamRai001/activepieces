import { FlowOperationType, FlowStatus, flowStructureUtil, type FlowTrigger } from '@activepieces/shared'
import type { FastifyBaseLogger } from 'fastify'
import { flowService } from '../flows/flow/flow.service'
import { pieceMetadataService } from '../pieces/metadata/piece-metadata-service'
import {
    createActivepiecesIrCompiler,
    type ActivepiecesIrCompilerDiagnostic,
    type ActivepiecesIrCompilerParams,
    type ActivepiecesIrCompilerResult,
} from './ir-compiler'

export type ActivepiecesDraftCompilerParams = ActivepiecesIrCompilerParams & {
    userId: string | null
}

export type ActivepiecesDraftCompilerResult =
    | {
        status: 'COMPLETE_DRAFT'
        flowId: string
        diagnostics: ActivepiecesIrCompilerDiagnostic[]
    }
    | {
        status: 'PARTIAL_DRAFT'
        flowId: string
        invalidSteps: string[]
        diagnostics: ActivepiecesIrCompilerDiagnostic[]
    }
    | {
        status: 'FAILED_CLEANLY'
        diagnostics: ActivepiecesIrCompilerDiagnostic[]
    }
    | {
        status: 'FAILED_WITH_ARTIFACT'
        flowId: string
        diagnostics: ActivepiecesIrCompilerDiagnostic[]
    }

type DraftArtifact = {
    id: string
    status: FlowStatus
    publishedVersionId: string | null
    version: {
        valid: boolean
        trigger: FlowTrigger
    }
}

export type ActivepiecesDraftCompilerDependencies = {
    compile(params: ActivepiecesIrCompilerParams): Promise<ActivepiecesIrCompilerResult>
    createFlow(params: {
        projectId: string
        userId: string | null
        displayName: string
    }): Promise<DraftArtifact>
    applyOperation(params: {
        flowId: string
        projectId: string
        platformId: string
        userId: string | null
        operation: Extract<ActivepiecesIrCompilerResult, { status: 'COMPILED' }>['operations'][number]
    }): Promise<DraftArtifact>
}

export const createActivepiecesDraftCompiler = (
    dependencies: ActivepiecesDraftCompilerDependencies,
) => ({
    async materialize(params: ActivepiecesDraftCompilerParams): Promise<ActivepiecesDraftCompilerResult> {
        const compiled = await dependencies.compile(params)
        if (compiled.status === 'FAILED') {
            return {
                status: 'FAILED_CLEANLY',
                diagnostics: compiled.diagnostics,
            }
        }

        let artifact: DraftArtifact
        try {
            artifact = await dependencies.createFlow({
                projectId: params.projectId,
                userId: params.userId,
                displayName: compiled.createRequest.displayName,
            })
        }
        catch (error) {
            return {
                status: 'FAILED_CLEANLY',
                diagnostics: [{
                    code: 'CREATE_FLOW_FAILED',
                    message: `Draft flow creation failed before an artifact was created: ${errorMessage(error)}`,
                }],
            }
        }

        try {
            for (const operation of compiled.operations) {
                assertNonPublishingOperation(operation.type)
                artifact = await dependencies.applyOperation({
                    flowId: artifact.id,
                    projectId: params.projectId,
                    platformId: params.platformId,
                    userId: params.userId,
                    operation,
                })
            }
        }
        catch (error) {
            return {
                status: 'FAILED_WITH_ARTIFACT',
                flowId: artifact.id,
                diagnostics: [{
                    code: 'APPLY_OPERATION_FAILED',
                    message: `Draft compilation failed after flow creation: ${errorMessage(error)}`,
                }],
            }
        }

        if (artifact.status !== FlowStatus.DISABLED || artifact.publishedVersionId !== null) {
            return {
                status: 'FAILED_WITH_ARTIFACT',
                flowId: artifact.id,
                diagnostics: [{
                    code: 'SAFETY_INVARIANT_VIOLATION',
                    message: 'Safety invariant violated: generated flow must remain DISABLED with no published version.',
                }],
            }
        }

        if (!artifact.version.valid) {
            const invalidSteps = flowStructureUtil
                .getAllSteps(artifact.version.trigger)
                .filter((step) => !step.valid)
                .map((step) => step.name)
            return {
                status: 'PARTIAL_DRAFT',
                flowId: artifact.id,
                invalidSteps,
                diagnostics: compiled.diagnostics,
            }
        }

        return {
            status: 'COMPLETE_DRAFT',
            flowId: artifact.id,
            diagnostics: compiled.diagnostics,
        }
    },
})

export const activepiecesIrCompilerService = (log: FastifyBaseLogger) => {
    const metadata = pieceMetadataService(log)
    const compiler = createActivepiecesIrCompiler({
        getPiece: ({ name, platformId, projectId }) => metadata.get({
            name,
            platformId,
            projectId,
        }),
        now: () => new Date().toISOString(),
    })

    return createActivepiecesDraftCompiler({
        compile: (params) => compiler.compile(params),
        createFlow: async ({ projectId, userId, displayName }) => {
            return flowService(log).create({
                projectId,
                ownerId: userId ?? undefined,
                request: {
                    displayName,
                    projectId,
                },
            })
        },
        applyOperation: async ({ flowId, projectId, platformId, userId, operation }) => {
            return flowService(log).update({
                id: flowId,
                projectId,
                platformId,
                userId,
                operation,
            })
        },
    })
}

function assertNonPublishingOperation(type: FlowOperationType): void {
    if (
        type === FlowOperationType.LOCK_AND_PUBLISH
        || type === FlowOperationType.CHANGE_STATUS
    ) {
        throw new Error(`Automation Architect compiler attempted forbidden flow operation "${type}".`)
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error'
}
