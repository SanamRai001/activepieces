import { isNil } from '@activepieces/core-utils'
import {
    FlowOperationType,
    FlowRun,
    FlowRunStatus,
    flowStructureUtil,
    isFlowRunStateTerminal,
    RunEnvironment,
    SampleDataFileType,
    Step,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { flowService } from '../flow/flow.service'
import { flowRunService } from '../flow-run/flow-run-service'
import { sampleDataService } from '../step-run/sample-data.service'
import { projectService } from '../../project/project-service'

const DEFAULT_POLL_INTERVAL_MS = 2000
const DEFAULT_MAX_WAIT_MS = 120_000

export type FlowTestTriggerDataSource =
    | 'USER_SUPPLIED_MOCK'
    | 'EXISTING_DRAFT_SAMPLE'
    | 'NO_TRIGGER_SAMPLE'

export type FlowTestOrchestrationStatus =
    | 'FLOW_NOT_FOUND'
    | 'TRIGGER_NOT_CONFIGURED'
    | 'STEP_NOT_FOUND'
    | 'FLOW_VERSION_CHANGED'
    | 'UNSAFE_TEST_RUN'
    | 'TEST_TIMEOUT'
    | 'TEST_COMPLETED'

export type FlowTestOrchestrationResult = {
    status: FlowTestOrchestrationStatus
    flowId: string
    flowVersionId?: string
    runId?: string
    runStatus?: FlowRunStatus
    failedStepName?: string | null
    triggerDataSource?: FlowTestTriggerDataSource
    usedMockTriggerData?: boolean
    availableStepNames?: string[]
    invalidStepDisplayNames?: string[]
    trigger?: Step
    run?: FlowRun
}

type FlowTestFlowSnapshot = {
    id: string
    version: {
        id: string
        trigger: Step
    }
}

export type FlowTestOrchestrationDependencies = {
    getFlow(params: { flowId: string, projectId: string }): Promise<FlowTestFlowSnapshot | null>
    saveMockTriggerData(params: {
        flowId: string
        projectId: string
        userId?: string
        payload: Record<string, unknown>
    }): Promise<FlowTestFlowSnapshot>
    startTest(params: {
        projectId: string
        flowVersionId: string
        stepName?: string
    }): Promise<FlowRun>
    getRun(params: { runId: string, projectId: string }): Promise<FlowRun>
    sleep(ms: number): Promise<void>
}

export type FlowTestOrchestrationOptions = {
    pollIntervalMs?: number
    maxWaitMs?: number
}

export function createFlowTestOrchestrationService(
    dependencies: FlowTestOrchestrationDependencies,
    options: FlowTestOrchestrationOptions = {},
) {
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS

    return {
        async test(params: {
            flowId: string
            projectId: string
            userId?: string
            stepName?: string
            triggerTestData?: Record<string, unknown>
            expectedFlowVersionId?: string
        }): Promise<FlowTestOrchestrationResult> {
            let flow = await dependencies.getFlow({
                flowId: params.flowId,
                projectId: params.projectId,
            })

            if (flow === null) {
                return {
                    status: 'FLOW_NOT_FOUND',
                    flowId: params.flowId,
                }
            }

            if (
                params.expectedFlowVersionId !== undefined
                && flow.version.id !== params.expectedFlowVersionId
            ) {
                return {
                    status: 'FLOW_VERSION_CHANGED',
                    flowId: flow.id,
                    flowVersionId: flow.version.id,
                }
            }

            if (!flow.version.trigger.valid) {
                return {
                    status: 'TRIGGER_NOT_CONFIGURED',
                    flowId: flow.id,
                    flowVersionId: flow.version.id,
                }
            }

            const allSteps = flowStructureUtil.getAllSteps(flow.version.trigger)
            if (params.stepName !== undefined) {
                const step = flowStructureUtil.getStep(
                    params.stepName,
                    flow.version.trigger,
                )
                if (isNil(step)) {
                    return {
                        status: 'STEP_NOT_FOUND',
                        flowId: flow.id,
                        flowVersionId: flow.version.id,
                        availableStepNames: allSteps.map((candidate) => candidate.name),
                    }
                }
            }

            const invalidStepDisplayNames = params.stepName === undefined
                ? allSteps
                    .filter((step) =>
                        !step.valid && !flowStructureUtil.isTrigger(step.type),
                    )
                    .map((step) => step.displayName)
                : []

            const usedMockTriggerData = params.triggerTestData !== undefined
            let triggerDataSource: FlowTestTriggerDataSource = hasTriggerSample(
                flow.version.trigger,
            )
                ? 'EXISTING_DRAFT_SAMPLE'
                : 'NO_TRIGGER_SAMPLE'

            if (params.triggerTestData !== undefined) {
                flow = await dependencies.saveMockTriggerData({
                    flowId: flow.id,
                    projectId: params.projectId,
                    userId: params.userId,
                    payload: params.triggerTestData,
                })
                triggerDataSource = 'USER_SUPPLIED_MOCK'

                if (
                    params.expectedFlowVersionId !== undefined
                    && flow.version.id !== params.expectedFlowVersionId
                ) {
                    return {
                        status: 'FLOW_VERSION_CHANGED',
                        flowId: flow.id,
                        flowVersionId: flow.version.id,
                        triggerDataSource,
                        usedMockTriggerData,
                    }
                }
            }

            const startedRun = await dependencies.startTest({
                projectId: params.projectId,
                flowVersionId: flow.version.id,
                stepName: params.stepName,
            })

            if (startedRun.environment !== RunEnvironment.TESTING) {
                return {
                    status: 'UNSAFE_TEST_RUN',
                    flowId: flow.id,
                    flowVersionId: flow.version.id,
                    runId: startedRun.id,
                    runStatus: startedRun.status,
                    triggerDataSource,
                    usedMockTriggerData,
                }
            }

            const completedRun = await pollForRunCompletion({
                dependencies,
                initialRun: startedRun,
                projectId: params.projectId,
                pollIntervalMs,
                maxWaitMs,
            })

            if (completedRun.environment !== RunEnvironment.TESTING) {
                return {
                    status: 'UNSAFE_TEST_RUN',
                    flowId: flow.id,
                    flowVersionId: flow.version.id,
                    runId: completedRun.id,
                    runStatus: completedRun.status,
                    triggerDataSource,
                    usedMockTriggerData,
                }
            }

            const common = {
                flowId: flow.id,
                flowVersionId: flow.version.id,
                runId: completedRun.id,
                runStatus: completedRun.status,
                failedStepName: completedRun.failedStep?.name ?? null,
                triggerDataSource,
                usedMockTriggerData,
                invalidStepDisplayNames,
                trigger: flow.version.trigger,
                run: completedRun,
            }

            if (!isFlowRunStateTerminal({
                status: completedRun.status,
                ignoreInternalError: false,
            })) {
                return {
                    status: 'TEST_TIMEOUT',
                    ...common,
                }
            }

            return {
                status: 'TEST_COMPLETED',
                ...common,
            }
        },
    }
}

export const flowTestOrchestrationService = (
    log: FastifyBaseLogger,
    options?: FlowTestOrchestrationOptions,
) => {
    const flows = flowService(log)
    const runs = flowRunService(log)
    const samples = sampleDataService(log)
    const projects = projectService(log)

    const mapFlow = (flow: Awaited<ReturnType<typeof flows.getOnePopulated>>) => {
        if (flow === null) {
            return null
        }
        return {
            id: flow.id,
            version: {
                id: flow.version.id,
                trigger: flow.version.trigger,
            },
        }
    }

    return createFlowTestOrchestrationService({
        getFlow: async ({ flowId, projectId }) =>
            mapFlow(await flows.getOnePopulated({
                id: flowId,
                projectId,
            })),
        saveMockTriggerData: async ({
            flowId,
            projectId,
            userId,
            payload,
        }) => {
            const flow = await flows.getOnePopulatedOrThrow({
                id: flowId,
                projectId,
            })
            const sampleDataSettings = await samples.saveSampleDataFileIdsInStep({
                projectId,
                flowVersionId: flow.version.id,
                stepName: flow.version.trigger.name,
                payload,
                type: SampleDataFileType.OUTPUT,
            })
            const project = await projects.getOneOrThrow(projectId)
            const updated = await flows.update({
                id: flow.id,
                projectId,
                userId,
                previousFlow: flow,
                platformId: project.platformId,
                operation: {
                    type: FlowOperationType.UPDATE_SAMPLE_DATA_INFO,
                    request: {
                        stepName: flow.version.trigger.name,
                        sampleDataSettings,
                    },
                },
            })
            return {
                id: updated.id,
                version: {
                    id: updated.version.id,
                    trigger: updated.version.trigger,
                },
            }
        },
        startTest: ({ projectId, flowVersionId, stepName }) =>
            runs.test({
                projectId,
                flowVersionId,
                stepNameToTest: stepName,
            }),
        getRun: ({ runId, projectId }) =>
            runs.getOnePopulatedOrThrow({
                id: runId,
                projectId,
            }),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    }, options)
}

async function pollForRunCompletion(params: {
    dependencies: FlowTestOrchestrationDependencies
    initialRun: FlowRun
    projectId: string
    pollIntervalMs: number
    maxWaitMs: number
}): Promise<FlowRun> {
    if (isFlowRunStateTerminal({
        status: params.initialRun.status,
        ignoreInternalError: false,
    })) {
        return params.initialRun
    }

    const startedAt = Date.now()
    let latest = params.initialRun

    while (Date.now() - startedAt < params.maxWaitMs) {
        await params.dependencies.sleep(params.pollIntervalMs)
        latest = await params.dependencies.getRun({
            runId: params.initialRun.id,
            projectId: params.projectId,
        })
        if (isFlowRunStateTerminal({
            status: latest.status,
            ignoreInternalError: false,
        })) {
            return latest
        }
    }

    return params.dependencies.getRun({
        runId: params.initialRun.id,
        projectId: params.projectId,
    })
}

function hasTriggerSample(trigger: Step): boolean {
    if (!('settings' in trigger)) {
        return false
    }
    const settings = trigger.settings as {
        sampleData?: {
            sampleDataFileId?: string
        }
    }
    return typeof settings.sampleData?.sampleDataFileId === 'string'
}
