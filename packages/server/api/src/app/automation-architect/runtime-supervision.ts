import {
    FlowRunStatus,
    isFlowRunStateTerminal,
    RunEnvironment,
} from '@activepieces/shared'
import type {
    AutomationRuntimeSupervision,
    AutomationRuntimeSupervisionDecision,
    AutomationRuntimeSupervisionState,
} from './runtime-supervision.entity'

export type RuntimeSupervisionObservedRun = {
    id: string
    projectId: string
    flowId: string
    flowVersionId: string
    environment: RunEnvironment
    status: FlowRunStatus
    created: string
    startTime?: string | null
    finishTime?: string | null
    failedStep?: {
        name: string
        message?: string
    }
}

export type RuntimeSupervisionActivation = {
    id: string
    occurredAt: string
}

export type RuntimeSupervisionReduction =
    | {
        action: 'APPLY'
        record: Omit<AutomationRuntimeSupervision, 'created' | 'updated'>
    }
    | {
        action: 'IGNORE_DUPLICATE' | 'IGNORE_STALE'
    }

export function reduceRuntimeSupervision(params: {
    id: string
    existing: AutomationRuntimeSupervision | null
    activation: RuntimeSupervisionActivation
    run: RuntimeSupervisionObservedRun
}): RuntimeSupervisionReduction {
    const observedAt = observedAtForRun(params.run)
    const activationChanged = params.existing?.activationAuditId !== params.activation.id
    const existing = activationChanged ? null : params.existing

    if (existing?.latestRunId === params.run.id) {
        return { action: 'IGNORE_DUPLICATE' }
    }

    if (
        existing !== null
        && new Date(observedAt).getTime() < new Date(existing.lastObservedAt).getTime()
    ) {
        return { action: 'IGNORE_STALE' }
    }

    const base = baseRecord({
        id: params.id,
        existing,
        activation: params.activation,
        run: params.run,
        observedAt,
    })

    if (params.run.status === FlowRunStatus.SUCCEEDED) {
        const recovered = (existing?.consecutiveFailureCount ?? 0) > 0
        return {
            action: 'APPLY',
            record: {
                ...base,
                state: recovered ? 'RECOVERED' : 'HEALTHY',
                consecutiveFailureCount: 0,
                lastDecision: recovered ? 'RECOVERY_CONFIRMED' : 'RUN_SUCCEEDED',
                lastSuccessAt: observedAt,
            },
        }
    }

    if (params.run.status === FlowRunStatus.CANCELED) {
        return {
            action: 'APPLY',
            record: {
                ...base,
                state: 'OBSERVING',
                lastDecision: 'RUN_CANCELED',
            },
        }
    }

    return {
        action: 'APPLY',
        record: {
            ...base,
            state: 'UNCLASSIFIED_FAILURE',
            consecutiveFailureCount: (existing?.consecutiveFailureCount ?? 0) + 1,
            lastDecision: 'FAILURE_RECORDED',
            lastFailureAt: observedAt,
            lastFailureStatus: params.run.status,
            lastFailedStepName: params.run.failedStep?.name ?? null,
            lastFailureMessage: params.run.failedStep?.message ?? null,
        },
    }
}

export function isRuntimeSupervisionTerminalRun(run: RuntimeSupervisionObservedRun): boolean {
    return isFlowRunStateTerminal({
        status: run.status,
        ignoreInternalError: false,
    })
}

function baseRecord(params: {
    id: string
    existing: AutomationRuntimeSupervision | null
    activation: RuntimeSupervisionActivation
    run: RuntimeSupervisionObservedRun
    observedAt: string
}): Omit<AutomationRuntimeSupervision, 'created' | 'updated'> {
    const reset = params.existing === null

    return {
        id: params.id,
        projectId: params.run.projectId,
        flowId: params.run.flowId,
        flowVersionId: params.run.flowVersionId,
        activationAuditId: params.activation.id,
        latestRunId: params.run.id,
        state: 'OBSERVING',
        consecutiveFailureCount: reset ? 0 : params.existing.consecutiveFailureCount,
        recoveryAttemptCount: reset ? 0 : params.existing.recoveryAttemptCount,
        lastDecision: 'RUN_SUCCEEDED',
        humanEscalationRequired: reset ? false : params.existing.humanEscalationRequired,
        lastObservedAt: params.observedAt,
        lastSuccessAt: reset ? null : params.existing.lastSuccessAt,
        lastFailureAt: reset ? null : params.existing.lastFailureAt,
        lastRunStatus: params.run.status,
        lastFailureStatus: reset ? null : params.existing.lastFailureStatus,
        lastFailedStepName: reset ? null : params.existing.lastFailedStepName,
        lastFailureMessage: reset ? null : params.existing.lastFailureMessage,
    }
}

function observedAtForRun(run: RuntimeSupervisionObservedRun): string {
    return run.finishTime ?? run.startTime ?? run.created
}

export const RUNTIME_SUPERVISION_INITIAL_STATES: AutomationRuntimeSupervisionState[] = [
    'OBSERVING',
    'HEALTHY',
    'UNCLASSIFIED_FAILURE',
    'RECOVERED',
]

export const RUNTIME_SUPERVISION_INITIAL_DECISIONS: AutomationRuntimeSupervisionDecision[] = [
    'RUN_SUCCEEDED',
    'FAILURE_RECORDED',
    'RECOVERY_CONFIRMED',
    'RUN_CANCELED',
]
