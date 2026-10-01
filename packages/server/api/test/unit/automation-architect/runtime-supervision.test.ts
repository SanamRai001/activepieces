import {
    FlowRunStatus,
    RunEnvironment,
} from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import type { AutomationRuntimeSupervision } from '../../../src/app/automation-architect/runtime-supervision.entity'
import {
    createRuntimeSupervisionService,
    type RuntimeSupervisionDependencies,
} from '../../../src/app/automation-architect/runtime-supervision.service'
import {
    reduceRuntimeSupervision,
    type RuntimeSupervisionObservedRun,
} from '../../../src/app/automation-architect/runtime-supervision'

const activation = {
    id: 'activation-1',
    occurredAt: '2026-10-01T10:00:00.000Z',
}

const successRun: RuntimeSupervisionObservedRun = {
    id: 'run-1',
    projectId: 'project-1',
    flowId: 'flow-1',
    flowVersionId: 'version-1',
    environment: RunEnvironment.PRODUCTION,
    status: FlowRunStatus.SUCCEEDED,
    created: '2026-10-01T10:01:00.000Z',
    startTime: '2026-10-01T10:01:01.000Z',
    finishTime: '2026-10-01T10:01:05.000Z',
}

function existingState(overrides: Partial<AutomationRuntimeSupervision> = {}): AutomationRuntimeSupervision {
    return {
        id: 'supervision-1',
        created: '2026-10-01T10:00:00.000Z',
        updated: '2026-10-01T10:01:00.000Z',
        projectId: 'project-1',
        flowId: 'flow-1',
        flowVersionId: 'version-1',
        activationAuditId: 'activation-1',
        latestRunId: 'run-0',
        state: 'HEALTHY',
        consecutiveFailureCount: 0,
        recoveryAttemptCount: 0,
        lastDecision: 'RUN_SUCCEEDED',
        humanEscalationRequired: false,
        lastObservedAt: '2026-10-01T10:00:30.000Z',
        lastSuccessAt: '2026-10-01T10:00:30.000Z',
        lastFailureAt: null,
        lastRunStatus: FlowRunStatus.SUCCEEDED,
        lastFailureStatus: null,
        lastFailedStepName: null,
        lastFailureMessage: null,
        ...overrides,
    }
}

describe('runtime supervision reducer', () => {
    it('marks the first successful production run healthy', () => {
        const result = reduceRuntimeSupervision({
            id: 'supervision-1',
            existing: null,
            activation,
            run: successRun,
        })

        expect(result.action).toBe('APPLY')
        if (result.action !== 'APPLY') {
            throw new Error('Expected an applied supervision state.')
        }

        expect(result.record).toEqual(expect.objectContaining({
            state: 'HEALTHY',
            consecutiveFailureCount: 0,
            lastDecision: 'RUN_SUCCEEDED',
            latestRunId: 'run-1',
        }))
    })

    it('records failures without claiming they are retryable', () => {
        const run: RuntimeSupervisionObservedRun = {
            ...successRun,
            id: 'run-failed',
            status: FlowRunStatus.FAILED,
            finishTime: '2026-10-01T10:02:00.000Z',
            failedStep: {
                name: 'send_email',
                message: 'provider error',
            },
        }

        const result = reduceRuntimeSupervision({
            id: 'supervision-1',
            existing: existingState(),
            activation,
            run,
        })

        expect(result.action).toBe('APPLY')
        if (result.action !== 'APPLY') {
            throw new Error('Expected an applied supervision state.')
        }

        expect(result.record).toEqual(expect.objectContaining({
            state: 'UNCLASSIFIED_FAILURE',
            consecutiveFailureCount: 1,
            lastDecision: 'FAILURE_RECORDED',
            lastFailureStatus: FlowRunStatus.FAILED,
            lastFailedStepName: 'send_email',
            lastFailureMessage: 'provider error',
        }))
    })

    it('increments consecutive failures but does not schedule recovery', () => {
        const result = reduceRuntimeSupervision({
            id: 'supervision-1',
            existing: existingState({
                state: 'UNCLASSIFIED_FAILURE',
                consecutiveFailureCount: 2,
                lastDecision: 'FAILURE_RECORDED',
                lastFailureAt: '2026-10-01T10:01:00.000Z',
                lastFailureStatus: FlowRunStatus.TIMEOUT,
            }),
            activation,
            run: {
                ...successRun,
                id: 'run-timeout',
                status: FlowRunStatus.TIMEOUT,
                finishTime: '2026-10-01T10:03:00.000Z',
            },
        })

        expect(result.action).toBe('APPLY')
        if (result.action !== 'APPLY') {
            throw new Error('Expected an applied supervision state.')
        }
        expect(result.record.consecutiveFailureCount).toBe(3)
        expect(result.record.state).toBe('UNCLASSIFIED_FAILURE')
        expect(result.record.recoveryAttemptCount).toBe(0)
    })

    it('marks a success after failure as recovered', () => {
        const result = reduceRuntimeSupervision({
            id: 'supervision-1',
            existing: existingState({
                state: 'UNCLASSIFIED_FAILURE',
                consecutiveFailureCount: 2,
                lastDecision: 'FAILURE_RECORDED',
                lastFailureAt: '2026-10-01T10:01:00.000Z',
                lastFailureStatus: FlowRunStatus.FAILED,
            }),
            activation,
            run: {
                ...successRun,
                id: 'run-recovered',
                finishTime: '2026-10-01T10:04:00.000Z',
            },
        })

        expect(result.action).toBe('APPLY')
        if (result.action !== 'APPLY') {
            throw new Error('Expected an applied supervision state.')
        }
        expect(result.record.state).toBe('RECOVERED')
        expect(result.record.consecutiveFailureCount).toBe(0)
        expect(result.record.lastDecision).toBe('RECOVERY_CONFIRMED')
    })

    it('ignores duplicate and older run observations', () => {
        const duplicate = reduceRuntimeSupervision({
            id: 'supervision-1',
            existing: existingState({
                latestRunId: successRun.id,
                lastObservedAt: successRun.finishTime ?? successRun.created,
            }),
            activation,
            run: successRun,
        })
        expect(duplicate.action).toBe('IGNORE_DUPLICATE')

        const stale = reduceRuntimeSupervision({
            id: 'supervision-1',
            existing: existingState({
                lastObservedAt: '2026-10-01T10:10:00.000Z',
            }),
            activation,
            run: successRun,
        })
        expect(stale.action).toBe('IGNORE_STALE')

        const sameTimestampDifferentRun = reduceRuntimeSupervision({
            id: 'supervision-1',
            existing: existingState({
                latestRunId: 'run-previous',
                lastObservedAt: successRun.finishTime ?? successRun.created,
            }),
            activation,
            run: {
                ...successRun,
                id: 'run-same-timestamp',
            },
        })
        expect(sameTimestampDifferentRun.action).toBe('APPLY')
    })

    it('resets counters when a later activation starts a new supervision epoch', () => {
        const result = reduceRuntimeSupervision({
            id: 'supervision-1',
            existing: existingState({
                activationAuditId: 'activation-old',
                consecutiveFailureCount: 4,
                recoveryAttemptCount: 2,
                humanEscalationRequired: true,
                lastFailureStatus: FlowRunStatus.FAILED,
                lastFailureAt: '2026-10-01T09:00:00.000Z',
            }),
            activation,
            run: successRun,
        })

        expect(result.action).toBe('APPLY')
        if (result.action !== 'APPLY') {
            throw new Error('Expected an applied supervision state.')
        }
        expect(result.record.activationAuditId).toBe('activation-1')
        expect(result.record.consecutiveFailureCount).toBe(0)
        expect(result.record.recoveryAttemptCount).toBe(0)
        expect(result.record.humanEscalationRequired).toBe(false)
        expect(result.record.lastFailureStatus).toBeNull()
    })
})

describe('runtime supervision observer', () => {
    function dependencies(
        overrides: Partial<RuntimeSupervisionDependencies> = {},
    ): {
        deps: RuntimeSupervisionDependencies
        saved: Array<Omit<AutomationRuntimeSupervision, 'created' | 'updated'>>
    } {
        const saved: Array<Omit<AutomationRuntimeSupervision, 'created' | 'updated'>> = []
        const deps: RuntimeSupervisionDependencies = {
            getRun: async () => successRun,
            getLatestActivation: async () => activation,
            getState: async () => null,
            saveState: async (record) => {
                saved.push(record)
                return {
                    ...record,
                    created: '2026-10-01T10:05:00.000Z',
                    updated: '2026-10-01T10:05:00.000Z',
                }
            },
            newId: () => 'supervision-1',
            withFlowLock: async ({ fn }) => fn(),
            ...overrides,
        }
        return { deps, saved }
    }

    it('ignores test runs', async () => {
        const { deps, saved } = dependencies({
            getRun: async () => ({
                ...successRun,
                environment: RunEnvironment.TESTING,
            }),
        })
        const service = createRuntimeSupervisionService(deps)

        const result = await service.observeFinishedRun({
            projectId: 'project-1',
            runId: 'run-1',
        })

        expect(result.status).toBe('IGNORED_NON_PRODUCTION')
        expect(saved).toHaveLength(0)
    })

    it('ignores flows that were not activated through Automation Architect', async () => {
        const { deps, saved } = dependencies({
            getLatestActivation: async () => null,
        })
        const service = createRuntimeSupervisionService(deps)

        const result = await service.observeFinishedRun({
            projectId: 'project-1',
            runId: 'run-1',
        })

        expect(result.status).toBe('IGNORED_NOT_AUTOMATION_ARCHITECT')
        expect(saved).toHaveLength(0)
    })

    it('ignores a run that started before the latest activation event', async () => {
        const { deps, saved } = dependencies({
            getLatestActivation: async () => ({
                id: 'activation-2',
                occurredAt: '2026-10-01T10:02:00.000Z',
            }),
        })
        const service = createRuntimeSupervisionService(deps)

        const result = await service.observeFinishedRun({
            projectId: 'project-1',
            runId: 'run-1',
        })

        expect(result.status).toBe('IGNORED_PRE_ACTIVATION_RUN')
        expect(saved).toHaveLength(0)
    })

    it('persists state for an activated production run', async () => {
        const { deps, saved } = dependencies()
        const service = createRuntimeSupervisionService(deps)

        const result = await service.observeFinishedRun({
            projectId: 'project-1',
            runId: 'run-1',
        })

        expect(result.status).toBe('OBSERVED')
        expect(saved).toHaveLength(1)
        expect(saved[0]).toEqual(expect.objectContaining({
            activationAuditId: 'activation-1',
            latestRunId: 'run-1',
            state: 'HEALTHY',
        }))
    })

    it('does not persist a duplicate event', async () => {
        const { deps, saved } = dependencies({
            getState: async () => existingState({
                latestRunId: 'run-1',
                lastObservedAt: successRun.finishTime ?? successRun.created,
            }),
        })
        const service = createRuntimeSupervisionService(deps)

        const result = await service.observeFinishedRun({
            projectId: 'project-1',
            runId: 'run-1',
        })

        expect(result.status).toBe('IGNORED_DUPLICATE')
        expect(saved).toHaveLength(0)
    })

    it('ignores a non-terminal run if invoked outside the finished-event path', async () => {
        const { deps, saved } = dependencies({
            getRun: async () => ({
                ...successRun,
                status: FlowRunStatus.RUNNING,
            }),
        })
        const service = createRuntimeSupervisionService(deps)

        const result = await service.observeFinishedRun({
            projectId: 'project-1',
            runId: 'run-1',
        })

        expect(result.status).toBe('IGNORED_NON_TERMINAL')
        expect(saved).toHaveLength(0)
    })
})
