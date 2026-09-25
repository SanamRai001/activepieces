import { FlowRunStatus } from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import {
    AutomationDraftSimulationDependencies,
    createAutomationDraftSimulationService,
} from '../../../src/app/automation-architect/draft-simulation.service'

function dependencies(
    overrides: Partial<AutomationDraftSimulationDependencies> = {},
): AutomationDraftSimulationDependencies {
    return {
        validateDraft: async () => ({
            status: 'VALIDATED_DRAFT',
            flowId: 'flow-1',
            flowVersionId: 'version-1',
            structural: {
                totalSteps: 2,
                validSteps: 2,
                invalidSteps: 0,
                skippedSteps: 0,
                issues: [],
            },
        }),
        testDraft: async () => ({
            status: 'TEST_COMPLETED',
            flowId: 'flow-1',
            flowVersionId: 'version-1',
            runId: 'run-1',
            runStatus: FlowRunStatus.SUCCEEDED,
            failedStepName: null,
            triggerDataSource: 'EXISTING_DRAFT_SAMPLE',
            usedMockTriggerData: false,
        }),
        ...overrides,
    }
}

describe('Automation draft simulation service', () => {
    it('maps a successful test run to TEST_SUCCEEDED', async () => {
        const service = createAutomationDraftSimulationService(dependencies())

        const result = await service.simulate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'TEST_SUCCEEDED',
            flowVersionId: 'version-1',
            runId: 'run-1',
            triggerDataSource: 'EXISTING_DRAFT_SAMPLE',
        }))
    })

    it('preserves explicit mock-data labeling', async () => {
        const service = createAutomationDraftSimulationService(dependencies({
            testDraft: async () => ({
                status: 'TEST_COMPLETED',
                flowId: 'flow-1',
                flowVersionId: 'version-1',
                runId: 'run-1',
                runStatus: FlowRunStatus.SUCCEEDED,
                failedStepName: null,
                triggerDataSource: 'USER_SUPPLIED_MOCK',
                usedMockTriggerData: true,
            }),
        }))

        const result = await service.simulate({
            flowId: 'flow-1',
            projectId: 'project-1',
            triggerTestData: {
                example: true,
            },
        })

        expect(result.status).toBe('TEST_SUCCEEDED')
        expect(result.triggerDataSource).toBe('USER_SUPPLIED_MOCK')
        expect(result.usedMockTriggerData).toBe(true)
    })

    it('maps failed terminal runs to TEST_FAILED', async () => {
        const service = createAutomationDraftSimulationService(dependencies({
            testDraft: async () => ({
                status: 'TEST_COMPLETED',
                flowId: 'flow-1',
                flowVersionId: 'version-1',
                runId: 'run-1',
                runStatus: FlowRunStatus.FAILED,
                failedStepName: 'step_1',
                triggerDataSource: 'NO_TRIGGER_SAMPLE',
                usedMockTriggerData: false,
            }),
        }))

        const result = await service.simulate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('TEST_FAILED')
        expect(result.failedStepName).toBe('step_1')
    })

    it('maps non-terminal timeout without pretending the run failed', async () => {
        const service = createAutomationDraftSimulationService(dependencies({
            testDraft: async () => ({
                status: 'TEST_TIMEOUT',
                flowId: 'flow-1',
                flowVersionId: 'version-1',
                runId: 'run-1',
                runStatus: FlowRunStatus.RUNNING,
                triggerDataSource: 'NO_TRIGGER_SAMPLE',
                usedMockTriggerData: false,
            }),
        }))

        const result = await service.simulate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('TEST_TIMEOUT')
        expect(result.runStatus).toBe(FlowRunStatus.RUNNING)
    })

    it('maps a terminal engine timeout to TEST_TIMEOUT', async () => {
        const service = createAutomationDraftSimulationService(dependencies({
            testDraft: async () => ({
                status: 'TEST_COMPLETED',
                flowId: 'flow-1',
                flowVersionId: 'version-1',
                runId: 'run-1',
                runStatus: FlowRunStatus.TIMEOUT,
                failedStepName: 'step_1',
                triggerDataSource: 'NO_TRIGGER_SAMPLE',
                usedMockTriggerData: false,
            }),
        }))

        const result = await service.simulate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('TEST_TIMEOUT')
        expect(result.runStatus).toBe(FlowRunStatus.TIMEOUT)
    })

    it('does not test a draft that needs configuration', async () => {
        let tested = false
        const service = createAutomationDraftSimulationService(dependencies({
            validateDraft: async () => ({
                status: 'NEEDS_CONFIGURATION',
                flowId: 'flow-1',
                flowVersionId: 'version-1',
                structural: {
                    totalSteps: 2,
                    validSteps: 1,
                    invalidSteps: 1,
                    skippedSteps: 0,
                    issues: [{
                        category: 'step_validity',
                        severity: 'error',
                        stepName: 'step_1',
                        message: 'Step is invalid.',
                    }],
                },
            }),
            testDraft: async () => {
                tested = true
                throw new Error('should not run')
            },
        }))

        const result = await service.simulate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('NEEDS_CONFIGURATION')
        expect(tested).toBe(false)
    })

    it('does not test an unsafe artifact', async () => {
        let tested = false
        const service = createAutomationDraftSimulationService(dependencies({
            validateDraft: async () => ({
                status: 'UNSAFE_ARTIFACT',
                flowId: 'flow-1',
                reasons: ['Flow is enabled.'],
            }),
            testDraft: async () => {
                tested = true
                throw new Error('should not run')
            },
        }))

        const result = await service.simulate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('UNSAFE_ARTIFACT')
        expect(tested).toBe(false)
    })

    it('maps version drift to UNSAFE_ARTIFACT', async () => {
        const service = createAutomationDraftSimulationService(dependencies({
            testDraft: async () => ({
                status: 'FLOW_VERSION_CHANGED',
                flowId: 'flow-1',
                flowVersionId: 'version-2',
            }),
        }))

        const result = await service.simulate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('UNSAFE_ARTIFACT')
        expect(result.reasons?.[0]).toContain('changed after validation')
    })

    it('maps missing flow without starting a test', async () => {
        let tested = false
        const service = createAutomationDraftSimulationService(dependencies({
            validateDraft: async () => ({
                status: 'FLOW_NOT_FOUND',
                flowId: 'missing',
            }),
            testDraft: async () => {
                tested = true
                throw new Error('should not run')
            },
        }))

        const result = await service.simulate({
            flowId: 'missing',
            projectId: 'project-1',
        })

        expect(result.status).toBe('FLOW_NOT_FOUND')
        expect(tested).toBe(false)
    })

    it('passes the validated version id into the runtime test', async () => {
        let expectedVersion: string | undefined
        const service = createAutomationDraftSimulationService(dependencies({
            testDraft: async (params) => {
                expectedVersion = params.expectedFlowVersionId
                return {
                    status: 'TEST_COMPLETED',
                    flowId: 'flow-1',
                    flowVersionId: 'version-1',
                    runId: 'run-1',
                    runStatus: FlowRunStatus.SUCCEEDED,
                    failedStepName: null,
                    triggerDataSource: 'NO_TRIGGER_SAMPLE',
                    usedMockTriggerData: false,
                }
            },
        }))

        await service.simulate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(expectedVersion).toBe('version-1')
    })
})
