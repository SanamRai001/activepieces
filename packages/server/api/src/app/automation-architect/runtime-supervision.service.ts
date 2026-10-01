import { apId, isNil } from '@activepieces/core-utils'
import {
    ApplicationEventName,
    FlowRunStatus,
    RunEnvironment,
    type FlowRun,
} from '@activepieces/shared'
import type { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../core/db/repo-factory'
import { distributedLock } from '../database/redis-connections'
import { flowRunService } from '../flows/flow-run/flow-run-service'
import { applicationEvents } from '../helper/application-events'
import {
    type AutomationActivationAudit,
    AutomationActivationAuditEntity,
} from './activation-audit.entity'
import {
    type AutomationRuntimeSupervision,
    AutomationRuntimeSupervisionEntity,
} from './runtime-supervision.entity'
import {
    isRuntimeSupervisionTerminalRun,
    reduceRuntimeSupervision,
    type RuntimeSupervisionActivation,
    type RuntimeSupervisionObservedRun,
} from './runtime-supervision'

const supervisionRepo = repoFactory<AutomationRuntimeSupervision>(AutomationRuntimeSupervisionEntity)
const activationAuditRepo = repoFactory<AutomationActivationAudit>(AutomationActivationAuditEntity)

export type RuntimeSupervisionObserveStatus =
    | 'OBSERVED'
    | 'IGNORED_RUN_NOT_FOUND'
    | 'IGNORED_NON_PRODUCTION'
    | 'IGNORED_NON_TERMINAL'
    | 'IGNORED_NOT_AUTOMATION_ARCHITECT'
    | 'IGNORED_PRE_ACTIVATION_RUN'
    | 'IGNORED_DUPLICATE'
    | 'IGNORED_STALE_RUN'

export type RuntimeSupervisionObserveResult = {
    status: RuntimeSupervisionObserveStatus
    supervision?: AutomationRuntimeSupervision
}

export type RuntimeSupervisionDependencies = {
    getRun(params: { projectId: string, runId: string }): Promise<RuntimeSupervisionObservedRun | null>
    getLatestActivation(params: {
        projectId: string
        flowId: string
        flowVersionId: string
    }): Promise<RuntimeSupervisionActivation | null>
    getState(params: {
        projectId: string
        flowId: string
        flowVersionId: string
    }): Promise<AutomationRuntimeSupervision | null>
    saveState(
        record: Omit<AutomationRuntimeSupervision, 'created' | 'updated'>,
    ): Promise<AutomationRuntimeSupervision>
    newId(): string
    withFlowLock<T>(params: {
        projectId: string
        flowId: string
        flowVersionId: string
        fn: () => Promise<T>
    }): Promise<T>
}

export function createRuntimeSupervisionService(dependencies: RuntimeSupervisionDependencies) {
    return {
        async observeFinishedRun(params: {
            projectId: string
            runId: string
        }): Promise<RuntimeSupervisionObserveResult> {
            const run = await dependencies.getRun(params)

            if (run === null) {
                return { status: 'IGNORED_RUN_NOT_FOUND' }
            }

            if (run.environment !== RunEnvironment.PRODUCTION) {
                return { status: 'IGNORED_NON_PRODUCTION' }
            }

            if (!isRuntimeSupervisionTerminalRun(run)) {
                return { status: 'IGNORED_NON_TERMINAL' }
            }

            return dependencies.withFlowLock({
                projectId: run.projectId,
                flowId: run.flowId,
                flowVersionId: run.flowVersionId,
                fn: async () => {
                    const activation = await dependencies.getLatestActivation({
                        projectId: run.projectId,
                        flowId: run.flowId,
                        flowVersionId: run.flowVersionId,
                    })

                    if (activation === null) {
                        return { status: 'IGNORED_NOT_AUTOMATION_ARCHITECT' }
                    }

                    if (startedAtForRun(run) < new Date(activation.occurredAt).getTime()) {
                        return { status: 'IGNORED_PRE_ACTIVATION_RUN' }
                    }

                    const existing = await dependencies.getState({
                        projectId: run.projectId,
                        flowId: run.flowId,
                        flowVersionId: run.flowVersionId,
                    })

                    const reduced = reduceRuntimeSupervision({
                        id: existing?.id ?? dependencies.newId(),
                        existing,
                        activation,
                        run,
                    })

                    if (reduced.action === 'IGNORE_DUPLICATE') {
                        return { status: 'IGNORED_DUPLICATE' }
                    }

                    if (reduced.action === 'IGNORE_STALE') {
                        return { status: 'IGNORED_STALE_RUN' }
                    }

                    const supervision = await dependencies.saveState(reduced.record)
                    return {
                        status: 'OBSERVED',
                        supervision,
                    }
                },
            })
        },
    }
}

export const runtimeSupervisionService = (log: FastifyBaseLogger) => {
    const runs = flowRunService(log)

    const service = createRuntimeSupervisionService({
        getRun: async ({ projectId, runId }) => {
            const run = await runs.getOne({
                id: runId,
                projectId,
            })
            return isNil(run) ? null : toObservedRun(run)
        },
        getLatestActivation: async ({ projectId, flowId, flowVersionId }) => {
            const activation = await activationAuditRepo().findOne({
                where: {
                    projectId,
                    flowId,
                    flowVersionId,
                    event: 'ACTIVATED',
                },
                order: {
                    occurredAt: 'DESC',
                },
            })
            return isNil(activation)
                ? null
                : {
                    id: activation.id,
                    occurredAt: activation.occurredAt,
                }
        },
        getState: async ({ projectId, flowId, flowVersionId }) => supervisionRepo().findOneBy({
            projectId,
            flowId,
            flowVersionId,
        }),
        saveState: async (record) => supervisionRepo().save(record),
        newId: apId,
        withFlowLock: async ({ projectId, flowId, flowVersionId, fn }) => distributedLock(log).runExclusive({
            key: `automation_runtime_supervision:${projectId}:${flowId}:${flowVersionId}`,
            timeoutInSeconds: 30,
            fn,
        }),
    })

    return {
        ...service,
        setup(): void {
            applicationEvents(log).registerListeners(log, {
                userEvent: () => () => undefined,
                workerEvent: () => async (projectId, event) => {
                    if (event.action !== ApplicationEventName.FLOW_RUN_FINISHED) {
                        return
                    }

                    await service.observeFinishedRun({
                        projectId,
                        runId: event.data.flowRun.id,
                    })
                },
            })
        },
    }
}

function toObservedRun(run: FlowRun): RuntimeSupervisionObservedRun {
    return {
        id: run.id,
        projectId: run.projectId,
        flowId: run.flowId,
        flowVersionId: run.flowVersionId,
        environment: run.environment,
        status: run.status,
        created: run.created,
        startTime: run.startTime,
        finishTime: run.finishTime,
        failedStep: run.failedStep,
    }
}

function startedAtForRun(run: RuntimeSupervisionObservedRun): number {
    return new Date(run.startTime ?? run.created).getTime()
}

export const RUNTIME_SUPERVISION_FAILURE_STATUSES: FlowRunStatus[] = [
    FlowRunStatus.FAILED,
    FlowRunStatus.INTERNAL_ERROR,
    FlowRunStatus.QUOTA_EXCEEDED,
    FlowRunStatus.MEMORY_LIMIT_EXCEEDED,
    FlowRunStatus.TIMEOUT,
    FlowRunStatus.LOG_SIZE_EXCEEDED,
]
