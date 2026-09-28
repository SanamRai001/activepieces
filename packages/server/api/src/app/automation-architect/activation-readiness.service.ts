import { apId } from '@activepieces/core-utils'
import { FlowActionType, flowStructureUtil } from '@activepieces/shared'
import type { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../core/db/repo-factory'
import { flowService } from '../flows/flow/flow.service'
import { flowRunService } from '../flows/flow-run/flow-run-service'
import { pieceMetadataService } from '../pieces/metadata/piece-metadata-service'
import { projectService } from '../project/project-service'
import {
    type AutomationActivationApproval,
    AutomationActivationApprovalEntity,
    type AutomationActivationRiskSnapshot,
} from './activation-approval.entity'
import {
    type AutomationActivationPolicy,
    type AutomationActivationReadinessResult,
    type AutomationSimulationEvidence,
    evaluateActivationReadiness,
} from './activation-readiness'
import {
    type AutomationDraftValidationResult,
    automationDraftValidationService,
} from './draft-validation.service'

const approvalRepo = repoFactory(AutomationActivationApprovalEntity)

export type ActivationReadinessDependencies = {
    validateDraft(params: { flowId: string, projectId: string }): Promise<AutomationDraftValidationResult>
    getSimulation(runId: string, projectId: string): Promise<AutomationSimulationEvidence | null>
    resolveRisks(params: {
        flowId: string
        projectId: string
        flowVersionId: string
    }): Promise<AutomationActivationRiskSnapshot[]>
    getLatestApproval(params: {
        projectId: string
        flowId: string
    }): Promise<AutomationActivationApproval | null>
    saveApproval(record: Omit<AutomationActivationApproval, 'created' | 'updated'>): Promise<AutomationActivationApproval>
}

export function createActivationReadinessService(dependencies: ActivationReadinessDependencies) {
    const assess = async (params: {
        flowId: string
        projectId: string
        expectedFlowVersionId: string
        simulationRunId?: string
        policy: AutomationActivationPolicy
    }): Promise<AutomationActivationReadinessResult> => {
        const validation = await dependencies.validateDraft({
            flowId: params.flowId,
            projectId: params.projectId,
        })

        if (
            validation.status !== 'VALIDATED_DRAFT'
            || validation.flowVersionId === undefined
        ) {
            return evaluateActivationReadiness({
                ...params,
                validation,
                simulation: null,
                riskSnapshot: [],
                approval: null,
            })
        }

        let simulation: AutomationSimulationEvidence | null = null
        if (params.simulationRunId !== undefined) {
            simulation = await dependencies.getSimulation(params.simulationRunId, params.projectId)
        }

        let risks: AutomationActivationRiskSnapshot[]
        try {
            risks = await dependencies.resolveRisks({
                flowId: params.flowId,
                projectId: params.projectId,
                flowVersionId: validation.flowVersionId,
            })
        }
        catch (error) {
            return {
                status: 'DENIED',
                flowId: params.flowId,
                flowVersionId: validation.flowVersionId,
                reasons: [
                    error instanceof Error
                        ? `Authoritative risk resolution failed: ${error.message}`
                        : 'Authoritative risk resolution failed.',
                ],
            }
        }

        const approval = await dependencies.getLatestApproval({
            projectId: params.projectId,
            flowId: params.flowId,
        })

        return evaluateActivationReadiness({
            ...params,
            validation,
            simulation,
            riskSnapshot: risks,
            approval,
        })
    }

    return {
        assess,
        async approve(params: {
            flowId: string
            projectId: string
            expectedFlowVersionId: string
            simulationRunId?: string
            policy: AutomationActivationPolicy
            approvedByUserId: string
        }): Promise<AutomationActivationReadinessResult> {
            const readiness = await assess(params)
            if (
                readiness.status !== 'APPROVAL_REQUIRED'
                && readiness.status !== 'STALE_APPROVAL'
            ) {
                return readiness
            }
            if (
                readiness.flowVersionId === undefined
                || readiness.policySnapshot === undefined
                || readiness.riskSnapshot === undefined
                || readiness.policyDigest === undefined
                || readiness.riskDigest === undefined
            ) {
                return {
                    status: 'DENIED',
                    flowId: params.flowId,
                    flowVersionId: readiness.flowVersionId,
                    reasons: ['Approval evidence was incomplete; refusing to create an approval record.'],
                }
            }

            const approvedAt = new Date().toISOString()
            const approval = await dependencies.saveApproval({
                id: apId(),
                projectId: params.projectId,
                flowId: params.flowId,
                flowVersionId: readiness.flowVersionId,
                approvedByUserId: params.approvedByUserId,
                approvedAt,
                simulationRunId: params.simulationRunId ?? null,
                policySnapshot: readiness.policySnapshot,
                riskSnapshot: readiness.riskSnapshot,
                policyDigest: readiness.policyDigest,
                riskDigest: readiness.riskDigest,
            })

            return {
                ...readiness,
                status: 'READY_TO_ACTIVATE',
                approvalId: approval.id,
                reasons: undefined,
            }
        },
    }
}

export const activationReadinessService = (log: FastifyBaseLogger) => {
    const draftValidation = automationDraftValidationService(log)
    const runs = flowRunService(log)
    const flows = flowService(log)
    const projects = projectService(log)
    const metadata = pieceMetadataService(log)

    return createActivationReadinessService({
        validateDraft: (params) => draftValidation.validate(params),
        getSimulation: async (runId, projectId) => {
            const run = await runs.getOne({
                id: runId,
                projectId,
            })
            if (run === null) {
                return null
            }
            return {
                runId: run.id,
                flowId: run.flowId,
                projectId: run.projectId,
                flowVersionId: run.flowVersionId,
                environment: run.environment,
                status: run.status,
            }
        },
        resolveRisks: async ({ flowId, projectId, flowVersionId }) => {
            const [flow, platformId] = await Promise.all([
                flows.getOnePopulated({
                    id: flowId,
                    projectId,
                }),
                projects.getPlatformId(projectId),
            ])
            if (flow === null || flow.version.id !== flowVersionId) {
                throw new Error('Flow version changed while resolving activation risks.')
            }

            const pieceActions = flowStructureUtil.getAllSteps(flow.version.trigger)
                .filter((step) => step.type === FlowActionType.PIECE)

            const risks: AutomationActivationRiskSnapshot[] = []
            for (const step of pieceActions) {
                const actionName = step.settings.actionName
                if (actionName === undefined) {
                    throw new Error(
                        `Piece action is not configured: ${step.settings.pieceName}/${step.name}.`,
                    )
                }

                const piece = await metadata.get({
                    name: step.settings.pieceName,
                    version: step.settings.pieceVersion,
                    platformId,
                    projectId,
                })
                const action = piece?.actions[actionName]
                if (piece === undefined || action === undefined) {
                    throw new Error(
                        `Piece action is no longer available: ${step.settings.pieceName}/${actionName}.`,
                    )
                }

                const mapped = mapActionRisk(action.classification)
                risks.push({
                    stepName: step.name,
                    pieceName: step.settings.pieceName,
                    actionName,
                    riskClass: mapped.riskClass,
                    rationale: mapped.rationale,
                })
            }
            return risks
        },
        getLatestApproval: async ({ projectId, flowId }) => {
            return approvalRepo().findOne({
                where: {
                    projectId,
                    flowId,
                },
                order: {
                    created: 'DESC',
                },
            })
        },
        saveApproval: async (record) => approvalRepo().save(record),
    })
}

function mapActionRisk(
    classification: string | undefined,
): Pick<AutomationActivationRiskSnapshot, 'riskClass' | 'rationale'> {
    switch (classification) {
        case 'READ':
        case 'SEARCH':
            return {
                riskClass: 'READ_ONLY',
                rationale: `Activepieces classifies this action as ${classification}.`,
            }
        case 'DESTRUCTIVE':
            return {
                riskClass: 'DESTRUCTIVE',
                rationale: 'Activepieces classifies this action as DESTRUCTIVE.',
            }
        case 'WRITE':
            return {
                riskClass: 'SENSITIVE_MUTATION',
                rationale: 'Activepieces classifies this action as WRITE; activation treats generic writes conservatively.',
            }
        default:
            return {
                riskClass: 'SENSITIVE_MUTATION',
                rationale: 'Action classification is missing or unknown; activation treats it conservatively.',
            }
    }
}
