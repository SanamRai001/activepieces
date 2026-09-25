import { FlowRunStatus } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import {
    AutomationDraftValidationResult,
    automationDraftValidationService,
} from './draft-validation.service'
import {
    FlowTestOrchestrationResult,
    flowTestOrchestrationService,
    FlowTestTriggerDataSource,
} from '../flows/testing/flow-test-orchestration.service'

export type AutomationDraftSimulationStatus =
    | 'TEST_SUCCEEDED'
    | 'TEST_FAILED'
    | 'TEST_TIMEOUT'
    | 'NEEDS_CONFIGURATION'
    | 'FLOW_NOT_FOUND'
    | 'UNSAFE_ARTIFACT'

export type AutomationDraftSimulationResult = {
    status: AutomationDraftSimulationStatus
    flowId: string
    flowVersionId?: string
    runId?: string
    runStatus?: FlowRunStatus
    failedStepName?: string | null
    triggerDataSource?: FlowTestTriggerDataSource
    usedMockTriggerData?: boolean
    reasons?: string[]
}

export type AutomationDraftSimulationDependencies = {
    validateDraft(params: {
        flowId: string
        projectId: string
    }): Promise<AutomationDraftValidationResult>
    testDraft(params: {
        flowId: string
        projectId: string
        userId?: string
        stepName?: string
        triggerTestData?: Record<string, unknown>
        expectedFlowVersionId?: string
    }): Promise<FlowTestOrchestrationResult>
}

export function createAutomationDraftSimulationService(
    dependencies: AutomationDraftSimulationDependencies,
) {
    return {
        async simulate(params: {
            flowId: string
            projectId: string
            userId?: string
            stepName?: string
            triggerTestData?: Record<string, unknown>
        }): Promise<AutomationDraftSimulationResult> {
            const validation = await dependencies.validateDraft({
                flowId: params.flowId,
                projectId: params.projectId,
            })

            switch (validation.status) {
                case 'FLOW_NOT_FOUND':
                    return {
                        status: 'FLOW_NOT_FOUND',
                        flowId: params.flowId,
                    }
                case 'UNSAFE_ARTIFACT':
                    return {
                        status: 'UNSAFE_ARTIFACT',
                        flowId: validation.flowId,
                        reasons: validation.reasons,
                    }
                case 'NEEDS_CONFIGURATION':
                    return {
                        status: 'NEEDS_CONFIGURATION',
                        flowId: validation.flowId,
                        flowVersionId: validation.flowVersionId,
                        reasons: validation.structural?.issues.map(
                            (issue) => issue.message,
                        ),
                    }
                case 'VALIDATED_DRAFT':
                    break
            }

            if (validation.flowVersionId === undefined) {
                return {
                    status: 'UNSAFE_ARTIFACT',
                    flowId: validation.flowId,
                    reasons: [
                        'Validated draft did not include a flow version id; refusing an unpinned test.',
                    ],
                }
            }

            const test = await dependencies.testDraft({
                flowId: validation.flowId,
                projectId: params.projectId,
                userId: params.userId,
                stepName: params.stepName,
                triggerTestData: params.triggerTestData,
                expectedFlowVersionId: validation.flowVersionId,
            })

            return mapTestResult(test)
        },
    }
}

export const automationDraftSimulationService = (
    log: FastifyBaseLogger,
) => {
    const validation = automationDraftValidationService(log)
    const testing = flowTestOrchestrationService(log)

    return createAutomationDraftSimulationService({
        validateDraft: (params) => validation.validate(params),
        testDraft: (params) => testing.test(params),
    })
}

function mapTestResult(
    test: FlowTestOrchestrationResult,
): AutomationDraftSimulationResult {
    const common = {
        flowId: test.flowId,
        flowVersionId: test.flowVersionId,
        runId: test.runId,
        runStatus: test.runStatus,
        failedStepName: test.failedStepName,
        triggerDataSource: test.triggerDataSource,
        usedMockTriggerData: test.usedMockTriggerData,
    }

    switch (test.status) {
        case 'FLOW_NOT_FOUND':
            return {
                status: 'FLOW_NOT_FOUND',
                flowId: test.flowId,
            }
        case 'TRIGGER_NOT_CONFIGURED':
            return {
                status: 'NEEDS_CONFIGURATION',
                ...common,
                reasons: ['Flow trigger is not configured.'],
            }
        case 'STEP_NOT_FOUND':
            return {
                status: 'NEEDS_CONFIGURATION',
                ...common,
                reasons: [
                    `Requested test step does not exist. Available steps: ${(
                        test.availableStepNames ?? []
                    ).join(', ')}`,
                ],
            }
        case 'FLOW_VERSION_CHANGED':
            return {
                status: 'UNSAFE_ARTIFACT',
                ...common,
                reasons: [
                    'Draft version changed after validation; revalidate before testing.',
                ],
            }
        case 'UNSAFE_TEST_RUN':
            return {
                status: 'UNSAFE_ARTIFACT',
                ...common,
                reasons: [
                    'Runtime returned a non-TESTING run; Automation Architect refused the result.',
                ],
            }
        case 'TEST_TIMEOUT':
            return {
                status: 'TEST_TIMEOUT',
                ...common,
            }
        case 'TEST_COMPLETED':
            if (test.runStatus === FlowRunStatus.SUCCEEDED) {
                return {
                    status: 'TEST_SUCCEEDED',
                    ...common,
                }
            }
            if (test.runStatus === FlowRunStatus.TIMEOUT) {
                return {
                    status: 'TEST_TIMEOUT',
                    ...common,
                }
            }
            return {
                status: 'TEST_FAILED',
                ...common,
            }
    }
}
