import { FlowStatus, FlowVersionState, Step } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { flowService } from '../flows/flow/flow.service'
import {
    FlowStructureValidationResult,
    hasNoBlockingFlowStructureIssues,
    validateFlowStructure,
} from '../flows/validation/flow-structure-validation'

export type AutomationDraftValidationStatus =
    | 'VALIDATED_DRAFT'
    | 'NEEDS_CONFIGURATION'
    | 'FLOW_NOT_FOUND'
    | 'UNSAFE_ARTIFACT'

export type AutomationDraftValidationResult = {
    status: AutomationDraftValidationStatus
    flowId: string
    structural?: FlowStructureValidationResult
    reasons?: string[]
}

type DraftFlowSnapshot = {
    id: string
    status: FlowStatus
    publishedVersionId: string | null
    version: {
        state: FlowVersionState
        trigger: Step
    }
}

export type AutomationDraftValidationDependencies = {
    getFlow(params: { flowId: string, projectId: string }): Promise<DraftFlowSnapshot | null>
}

export function createAutomationDraftValidationService(dependencies: AutomationDraftValidationDependencies) {
    return {
        async validate(params: { flowId: string, projectId: string }): Promise<AutomationDraftValidationResult> {
            const flow = await dependencies.getFlow(params)
            if (flow === null) {
                return {
                    status: 'FLOW_NOT_FOUND',
                    flowId: params.flowId,
                }
            }

            const safetyReasons = draftSafetyViolations(flow)
            if (safetyReasons.length > 0) {
                return {
                    status: 'UNSAFE_ARTIFACT',
                    flowId: flow.id,
                    reasons: safetyReasons,
                }
            }

            const structural = validateFlowStructure({
                trigger: flow.version.trigger,
            })
            const ready = hasNoBlockingFlowStructureIssues(structural.issues)
                && structural.validSteps > 0

            return {
                status: ready ? 'VALIDATED_DRAFT' : 'NEEDS_CONFIGURATION',
                flowId: flow.id,
                structural,
            }
        },
    }
}

export const automationDraftValidationService = (log: FastifyBaseLogger) => {
    const flows = flowService(log)
    return createAutomationDraftValidationService({
        getFlow: async ({ flowId, projectId }) => {
            const flow = await flows.getOnePopulated({
                id: flowId,
                projectId,
            })
            if (flow === null) {
                return null
            }

            return {
                id: flow.id,
                status: flow.status,
                publishedVersionId: flow.publishedVersionId ?? null,
                version: {
                    state: flow.version.state,
                    trigger: flow.version.trigger,
                },
            }
        },
    })
}

function draftSafetyViolations(flow: DraftFlowSnapshot): string[] {
    const reasons: string[] = []

    if (flow.status !== FlowStatus.DISABLED) {
        reasons.push(`Flow status must be DISABLED, received ${flow.status}.`)
    }
    if (flow.publishedVersionId !== null) {
        reasons.push('Flow has a published version and is not an isolated unpublished draft artifact.')
    }
    if (flow.version.state !== FlowVersionState.DRAFT) {
        reasons.push(`Flow version must be DRAFT, received ${flow.version.state}.`)
    }

    return reasons
}
