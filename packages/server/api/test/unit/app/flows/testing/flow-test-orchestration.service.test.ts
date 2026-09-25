import {
    FlowActionType,
    FlowRun,
    FlowRunStatus,
    FlowTriggerType,
    RunEnvironment,
    Step,
} from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import {
    createFlowTestOrchestrationService,
    FlowTestOrchestrationDependencies,
} from '../../../../../src/app/flows/testing/flow-test-orchestration.service'

const updatedAt = '2026-09-25T00:00:00.000Z'

function action(valid = true): Step {
    return {
        type: FlowActionType.PIECE,
        name: 'step_1',
        displayName: 'Step 1',
        valid,
        lastUpdatedDate: updatedAt,
        settings: {
            pieceName: '@activepieces/piece-example',
            pieceVersion: '1.0.0',
            actionName: 'run',
            input: {},
            propertySettings: {},
            errorHandlingOptions: {},
        },
    }
}

function trigger(params?: {
    valid?: boolean
    withSample?: boolean
    nextAction?: Step
}): Step {
    return {
        type: FlowTriggerType.PIECE,
        name: 'trigger',
        displayName: 'Trigger',
        valid: params?.valid ?? true,
        lastUpdatedDate: updatedAt,
        settings: {
            pieceName: '@activepieces/piece-example',
            pieceVersion: '1.0.0',
            triggerName: 'event',
            input: {},
            propertySettings: {},
            ...(params?.withSample
                ? {
                    sampleData: {
                        sampleDataFileId: 'sample-1',
                    },
                }
                : {}),
        },
        nextAction: params?.nextAction ?? action(),
    }
}

function run(
    status: FlowRunStatus,
    overrides: Partial<FlowRun> = {},
): FlowRun {
    return {
        id: 'run-1',
        projectId: 'project-1',
        flowId: 'flow-1',
        flowVersionId: 'version-1',
        environment: RunEnvironment.TESTING,
        status,
        created: updatedAt,
        updated: updatedAt,
        tags: [],
        steps: {},
        failParentOnFailure: true,
        ...overrides,
    }
}

function dependencies(
    overrides: Partial<FlowTestOrchestrationDependencies> = {},
): FlowTestOrchestrationDependencies {
    return {
        getFlow: async () => ({
            id: 'flow-1',
            version: {
                id: 'version-1',
                trigger: trigger(),
            },
        }),
        saveMockTriggerData: async () => ({
            id: 'flow-1',
            version: {
                id: 'version-1',
                trigger: trigger({ withSample: true }),
            },
        }),
        startTest: async () => run(FlowRunStatus.SUCCEEDED),
        getRun: async () => run(FlowRunStatus.SUCCEEDED),
        sleep: async () => undefined,
        ...overrides,
    }
}

describe('flow test orchestration service', () => {
    it('returns FLOW_NOT_FOUND in project scope', async () => {
        const service = createFlowTestOrchestrationService(dependencies({
            getFlow: async () => null,
        }))

        const result = await service.test({
            flowId: 'missing',
            projectId: 'project-1',
        })

        expect(result.status).toBe('FLOW_NOT_FOUND')
    })

    it('rejects an unconfigured trigger before starting a run', async () => {
        let started = false
        const service = createFlowTestOrchestrationService(dependencies({
            getFlow: async () => ({
                id: 'flow-1',
                version: {
                    id: 'version-1',
                    trigger: trigger({ valid: false }),
                },
            }),
            startTest: async () => {
                started = true
                return run(FlowRunStatus.SUCCEEDED)
            },
        }))

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('TRIGGER_NOT_CONFIGURED')
        expect(started).toBe(false)
    })

    it('rejects a missing requested step with available names', async () => {
        const service = createFlowTestOrchestrationService(dependencies())

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
            stepName: 'missing',
        })

        expect(result.status).toBe('STEP_NOT_FOUND')
        expect(result.availableStepNames).toEqual(['trigger', 'step_1'])
    })

    it('pins the validated draft version before test start', async () => {
        let started = false
        const service = createFlowTestOrchestrationService(dependencies({
            startTest: async () => {
                started = true
                return run(FlowRunStatus.SUCCEEDED)
            },
        }))

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
            expectedFlowVersionId: 'different-version',
        })

        expect(result.status).toBe('FLOW_VERSION_CHANGED')
        expect(started).toBe(false)
    })

    it('labels user supplied trigger payload as mock data', async () => {
        let savedPayload: Record<string, unknown> | undefined
        const service = createFlowTestOrchestrationService(dependencies({
            saveMockTriggerData: async ({ payload }) => {
                savedPayload = payload
                return {
                    id: 'flow-1',
                    version: {
                        id: 'version-1',
                        trigger: trigger({ withSample: true }),
                    },
                }
            },
        }))

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
            expectedFlowVersionId: 'version-1',
            triggerTestData: {
                id: 42,
            },
        })

        expect(savedPayload).toEqual({ id: 42 })
        expect(result.status).toBe('TEST_COMPLETED')
        expect(result.triggerDataSource).toBe('USER_SUPPLIED_MOCK')
        expect(result.usedMockTriggerData).toBe(true)
    })

    it('labels pre-existing draft sample without claiming real provenance', async () => {
        const service = createFlowTestOrchestrationService(dependencies({
            getFlow: async () => ({
                id: 'flow-1',
                version: {
                    id: 'version-1',
                    trigger: trigger({ withSample: true }),
                },
            }),
        }))

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.triggerDataSource).toBe('EXISTING_DRAFT_SAMPLE')
        expect(result.usedMockTriggerData).toBe(false)
    })

    it('labels absence of any trigger sample explicitly', async () => {
        const service = createFlowTestOrchestrationService(dependencies())

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.triggerDataSource).toBe('NO_TRIGGER_SAMPLE')
    })

    it('returns TEST_TIMEOUT when the run remains non-terminal', async () => {
        const queued = run(FlowRunStatus.QUEUED)
        const service = createFlowTestOrchestrationService(dependencies({
            startTest: async () => queued,
            getRun: async () => queued,
        }), {
            pollIntervalMs: 0,
            maxWaitMs: 0,
        })

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('TEST_TIMEOUT')
        expect(result.runId).toBe('run-1')
        expect(result.runStatus).toBe(FlowRunStatus.QUEUED)
    })

    it('returns terminal failed-step information', async () => {
        const failed = run(FlowRunStatus.FAILED, {
            failedStep: {
                name: 'step_1',
                displayName: 'Step 1',
            },
        })
        const service = createFlowTestOrchestrationService(dependencies({
            startTest: async () => failed,
        }))

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('TEST_COMPLETED')
        expect(result.runStatus).toBe(FlowRunStatus.FAILED)
        expect(result.failedStepName).toBe('step_1')
    })

    it('rejects a non-testing runtime result', async () => {
        const service = createFlowTestOrchestrationService(dependencies({
            startTest: async () => run(FlowRunStatus.SUCCEEDED, {
                environment: RunEnvironment.PRODUCTION,
            }),
        }))

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('UNSAFE_TEST_RUN')
    })

    it('reports invalid full-flow steps without blocking runtime orchestration itself', async () => {
        const service = createFlowTestOrchestrationService(dependencies({
            getFlow: async () => ({
                id: 'flow-1',
                version: {
                    id: 'version-1',
                    trigger: trigger({
                        nextAction: action(false),
                    }),
                },
            }),
        }))

        const result = await service.test({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.invalidStepDisplayNames).toEqual(['Step 1'])
    })
})
