import { apId } from '@activepieces/core-utils'
import {
    FlowOperationType,
    FlowStatus,
    FlowVersionState,
    type PopulatedFlow,
} from '@activepieces/shared'
import type { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../core/db/repo-factory'
import { platformPlanService } from '../ee/platform/platform-plan/platform-plan.service'
import { projectLimitsService } from '../ee/projects/project-plan/project-plan.service'
import { flowService } from '../flows/flow/flow.service'
import {
    type AutomationActivationAudit,
    AutomationActivationAuditEntity,
    type AutomationActivationAuditEvent,
} from './activation-audit.entity'
import { AUTOMATION_ARCHITECT_ACTIVATION_POLICY } from './activation-policy'
import {
    type AutomationActivationPolicy,
    type AutomationActivationReadinessResult,
} from './activation-readiness'
import { activationReadinessService } from './activation-readiness.service'

const activationAuditRepo = repoFactory(AutomationActivationAuditEntity)

export type ExplicitActivationStatus =
    | 'ACTIVATED'
    | 'NOT_READY'
    | 'FAILED_BEFORE_PUBLISH'
    | 'PUBLISHED_NOT_ENABLED'

export type ExplicitActivationResult = {
    status: ExplicitActivationStatus
    flowId: string
    flowVersionId?: string
    approvalId?: string
    activationAuditId?: string
    readiness?: AutomationActivationReadinessResult
    reason?: string
}

type PublishedFlowSnapshot = {
    status: FlowStatus
    publishedVersionId: string | null
    version: {
        id: string
        state: FlowVersionState
    }
}

export type ExplicitActivationDependencies = {
    assess(params: {
        flowId: string
        projectId: string
        expectedFlowVersionId: string
        simulationRunId?: string
        policy: AutomationActivationPolicy
    }): Promise<AutomationActivationReadinessResult>
    checkActivationLimits(params: { projectId: string, platformId: string }): Promise<void>
    publishExactDraft(params: {
        flowId: string
        projectId: string
        platformId: string
        actorUserId: string
        expectedFlowVersionId: string
        expectedFlowVersionUpdatedAt: string
        ip?: string
    }): Promise<PublishedFlowSnapshot>
    enablePublishedFlow(params: {
        flowId: string
        projectId: string
        platformId: string
        actorUserId: string
        ip?: string
    }): Promise<PublishedFlowSnapshot>
    saveAudit(record: Omit<AutomationActivationAudit, 'created' | 'updated'>): Promise<AutomationActivationAudit>
}

export function createExplicitActivationService(
    dependencies: ExplicitActivationDependencies,
    policy: AutomationActivationPolicy = AUTOMATION_ARCHITECT_ACTIVATION_POLICY,
) {
    return {
        async activate(params: {
            flowId: string
            projectId: string
            platformId: string
            actorUserId: string
            expectedFlowVersionId: string
            simulationRunId?: string
            ip?: string
        }): Promise<ExplicitActivationResult> {
            const readiness = await dependencies.assess({
                flowId: params.flowId,
                projectId: params.projectId,
                expectedFlowVersionId: params.expectedFlowVersionId,
                simulationRunId: params.simulationRunId,
                policy,
            })

            if (readiness.status !== 'READY_TO_ACTIVATE') {
                return {
                    status: 'NOT_READY',
                    flowId: params.flowId,
                    flowVersionId: readiness.flowVersionId,
                    approvalId: readiness.approvalId,
                    readiness,
                }
            }

            if (
                readiness.flowVersionId === undefined
                || readiness.flowVersionUpdatedAt === undefined
                || readiness.policyDigest === undefined
                || readiness.riskDigest === undefined
            ) {
                return {
                    status: 'NOT_READY',
                    flowId: params.flowId,
                    flowVersionId: readiness.flowVersionId,
                    readiness: {
                        ...readiness,
                        status: 'DENIED',
                        reasons: ['Activation readiness evidence is incomplete.'],
                    },
                }
            }

            const evidence = {
                projectId: params.projectId,
                flowId: params.flowId,
                flowVersionId: readiness.flowVersionId,
                flowVersionUpdatedAt: readiness.flowVersionUpdatedAt,
                actorUserId: params.actorUserId,
                approvalId: readiness.approvalId ?? null,
                simulationRunId: params.simulationRunId ?? null,
                policyDigest: readiness.policyDigest,
                riskDigest: readiness.riskDigest,
            }

            const attempt = await appendAudit(dependencies, {
                ...evidence,
                event: 'ATTEMPT_STARTED',
                failureReason: null,
            })

            try {
                await dependencies.checkActivationLimits({
                    projectId: params.projectId,
                    platformId: params.platformId,
                })
            }
            catch (error) {
                const reason = errorMessage(error, 'Activation limit check failed.')
                const audit = await appendAudit(dependencies, {
                    ...evidence,
                    event: 'FAILED_BEFORE_PUBLISH',
                    failureReason: reason,
                })
                return {
                    status: 'FAILED_BEFORE_PUBLISH',
                    flowId: params.flowId,
                    flowVersionId: readiness.flowVersionId,
                    approvalId: readiness.approvalId,
                    activationAuditId: audit.id,
                    reason,
                }
            }

            let published: PublishedFlowSnapshot
            try {
                published = await dependencies.publishExactDraft({
                    flowId: params.flowId,
                    projectId: params.projectId,
                    platformId: params.platformId,
                    actorUserId: params.actorUserId,
                    expectedFlowVersionId: readiness.flowVersionId,
                    expectedFlowVersionUpdatedAt: readiness.flowVersionUpdatedAt,
                    ip: params.ip,
                })
            }
            catch (error) {
                const reason = errorMessage(error, 'Publishing the approved draft failed.')
                const audit = await appendAudit(dependencies, {
                    ...evidence,
                    event: 'FAILED_BEFORE_PUBLISH',
                    failureReason: reason,
                })
                return {
                    status: 'FAILED_BEFORE_PUBLISH',
                    flowId: params.flowId,
                    flowVersionId: readiness.flowVersionId,
                    approvalId: readiness.approvalId,
                    activationAuditId: audit.id,
                    reason,
                }
            }

            const publishInvariantFailure = validatePublishedState(
                published,
                readiness.flowVersionId,
            )
            if (publishInvariantFailure !== null) {
                const event: AutomationActivationAuditEvent =
                    published.publishedVersionId === null
                        ? 'FAILED_BEFORE_PUBLISH'
                        : 'PUBLISHED_NOT_ENABLED'
                const audit = await appendAudit(dependencies, {
                    ...evidence,
                    event,
                    failureReason: publishInvariantFailure,
                })
                return {
                    status: event,
                    flowId: params.flowId,
                    flowVersionId: readiness.flowVersionId,
                    approvalId: readiness.approvalId,
                    activationAuditId: audit.id,
                    reason: publishInvariantFailure,
                }
            }

            await appendAudit(dependencies, {
                ...evidence,
                event: 'PUBLISHED',
                failureReason: null,
            })

            let enabled: PublishedFlowSnapshot
            try {
                enabled = await dependencies.enablePublishedFlow({
                    flowId: params.flowId,
                    projectId: params.projectId,
                    platformId: params.platformId,
                    actorUserId: params.actorUserId,
                    ip: params.ip,
                })
            }
            catch (error) {
                const reason = errorMessage(error, 'The draft was published but enablement failed.')
                const audit = await appendAudit(dependencies, {
                    ...evidence,
                    event: 'PUBLISHED_NOT_ENABLED',
                    failureReason: reason,
                })
                return {
                    status: 'PUBLISHED_NOT_ENABLED',
                    flowId: params.flowId,
                    flowVersionId: readiness.flowVersionId,
                    approvalId: readiness.approvalId,
                    activationAuditId: audit.id,
                    reason,
                }
            }

            if (
                enabled.status !== FlowStatus.ENABLED
                || enabled.publishedVersionId !== readiness.flowVersionId
                || enabled.version.id !== readiness.flowVersionId
            ) {
                const reason = 'Enablement returned a flow state that does not match the exact approved published version.'
                const audit = await appendAudit(dependencies, {
                    ...evidence,
                    event: 'PUBLISHED_NOT_ENABLED',
                    failureReason: reason,
                })
                return {
                    status: 'PUBLISHED_NOT_ENABLED',
                    flowId: params.flowId,
                    flowVersionId: readiness.flowVersionId,
                    approvalId: readiness.approvalId,
                    activationAuditId: audit.id,
                    reason,
                }
            }

            const activated = await appendAudit(dependencies, {
                ...evidence,
                event: 'ACTIVATED',
                failureReason: null,
            })

            return {
                status: 'ACTIVATED',
                flowId: params.flowId,
                flowVersionId: readiness.flowVersionId,
                approvalId: readiness.approvalId,
                activationAuditId: activated.id,
            }
        },
    }
}

export const explicitActivationService = (log: FastifyBaseLogger) => {
    const readiness = activationReadinessService(log)
    const flows = flowService(log)

    return createExplicitActivationService({
        assess: readiness.assess,
        checkActivationLimits: async ({ projectId, platformId }) => {
            await platformPlanService(log).checkActiveFlowsExceededLimit(platformId)
            await projectLimitsService(log).checkActiveFlowsExceededLimit({ projectId })
        },
        publishExactDraft: async (params) => {
            const flow = await flows.update({
                id: params.flowId,
                userId: params.actorUserId,
                projectId: params.projectId,
                platformId: params.platformId,
                ip: params.ip,
                expectedPublishedDraft: {
                    flowVersionId: params.expectedFlowVersionId,
                    flowVersionUpdatedAt: params.expectedFlowVersionUpdatedAt,
                },
                operation: {
                    type: FlowOperationType.LOCK_AND_PUBLISH,
                    request: {
                        status: FlowStatus.DISABLED,
                    },
                },
            })
            return toPublishedFlowSnapshot(flow)
        },
        enablePublishedFlow: async (params) => {
            const flow = await flows.update({
                id: params.flowId,
                userId: params.actorUserId,
                projectId: params.projectId,
                platformId: params.platformId,
                ip: params.ip,
                operation: {
                    type: FlowOperationType.CHANGE_STATUS,
                    request: {
                        status: FlowStatus.ENABLED,
                    },
                },
            })
            return toPublishedFlowSnapshot(flow)
        },
        saveAudit: async (record) => activationAuditRepo().save(record),
    })
}

async function appendAudit(
    dependencies: ExplicitActivationDependencies,
    record: Omit<AutomationActivationAudit, 'id' | 'created' | 'updated' | 'occurredAt'>,
): Promise<AutomationActivationAudit> {
    return dependencies.saveAudit({
        id: apId(),
        ...record,
        occurredAt: new Date().toISOString(),
    })
}

function validatePublishedState(
    flow: PublishedFlowSnapshot,
    expectedVersionId: string,
): string | null {
    if (flow.publishedVersionId !== expectedVersionId) {
        return 'Publishing did not produce the exact approved flow version.'
    }
    if (flow.status !== FlowStatus.DISABLED) {
        return 'Published flow must remain DISABLED until the explicit enable step.'
    }
    if (
        flow.version.id !== expectedVersionId
        || flow.version.state !== FlowVersionState.LOCKED
    ) {
        return 'Published flow version is not the exact approved locked version.'
    }
    return null
}

function toPublishedFlowSnapshot(flow: PopulatedFlow): PublishedFlowSnapshot {
    return {
        status: flow.status,
        publishedVersionId: flow.publishedVersionId ?? null,
        version: {
            id: flow.version.id,
            state: flow.version.state,
        },
    }
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}
