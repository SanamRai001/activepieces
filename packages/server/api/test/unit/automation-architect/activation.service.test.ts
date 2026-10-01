import {
    FlowStatus,
    FlowVersionState,
} from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import type { AutomationActivationAudit } from '../../../src/app/automation-architect/activation-audit.entity'
import { AUTOMATION_ARCHITECT_ACTIVATION_POLICY } from '../../../src/app/automation-architect/activation-policy'
import type { AutomationActivationReadinessResult } from '../../../src/app/automation-architect/activation-readiness'
import {
    createExplicitActivationService,
    type ExplicitActivationDependencies,
} from '../../../src/app/automation-architect/activation.service'

const flowId = 'flow_1234567890123456'
const projectId = 'proj_1234567890123456'
const platformId = 'plat_1234567890123456'
const userId = 'user_1234567890123456'
const versionId = 'vers_1234567890123456'
const versionUpdatedAt = '2026-09-25T00:00:00.000Z'
const runId = 'run__1234567890123456'
const approvalId = 'appr_1234567890123456'

const ready: AutomationActivationReadinessResult = {
    status: 'READY_TO_ACTIVATE',
    flowId,
    flowVersionId: versionId,
    flowVersionUpdatedAt: versionUpdatedAt,
    simulationRunId: runId,
    approvalId,
    policyDigest: 'a'.repeat(64),
    riskDigest: 'b'.repeat(64),
    policySnapshot: {
        riskPolicy: AUTOMATION_ARCHITECT_ACTIVATION_POLICY.riskPolicy,
        requireSuccessfulSimulation: true,
    },
    riskSnapshot: [],
}

function published(status: FlowStatus = FlowStatus.DISABLED) {
    return {
        status,
        publishedVersionId: versionId,
        version: {
            id: versionId,
            state: FlowVersionState.LOCKED,
        },
    }
}

function setup(overrides: Partial<ExplicitActivationDependencies> = {}) {
    const audits: AutomationActivationAudit[] = []
    const dependencies: ExplicitActivationDependencies = {
        assess: async () => ready,
        checkActivationLimits: async () => undefined,
        publishExactDraft: async () => published(),
        enablePublishedFlow: async () => published(FlowStatus.ENABLED),
        saveAudit: async (record) => {
            const saved: AutomationActivationAudit = {
                ...record,
                created: record.occurredAt,
                updated: record.occurredAt,
            }
            audits.push(saved)
            return saved
        },
        ...overrides,
    }
    return {
        service: createExplicitActivationService(dependencies),
        dependencies,
        audits,
    }
}

const request = {
    flowId,
    projectId,
    platformId,
    actorUserId: userId,
    expectedFlowVersionId: versionId,
    simulationRunId: runId,
}

describe('explicit safe activation service', () => {
    it('does not mutate or audit when the draft is not ready', async () => {
        let publishedCalled = false
        let auditCalled = false
        const { service } = setup({
            assess: async () => ({
                status: 'APPROVAL_REQUIRED',
                flowId,
                flowVersionId: versionId,
                flowVersionUpdatedAt: versionUpdatedAt,
                reasons: ['approval required'],
            }),
            publishExactDraft: async () => {
                publishedCalled = true
                return published()
            },
            saveAudit: async () => {
                auditCalled = true
                throw new Error('must not audit')
            },
        })

        const result = await service.activate(request)

        expect(result.status).toBe('NOT_READY')
        expect(publishedCalled).toBe(false)
        expect(auditCalled).toBe(false)
    })

    it('uses the fixed conservative server activation policy', async () => {
        let capturedPolicy = null as typeof AUTOMATION_ARCHITECT_ACTIVATION_POLICY | null
        const { service } = setup({
            assess: async (params) => {
                capturedPolicy = params.policy
                return ready
            },
        })

        await service.activate(request)

        expect(capturedPolicy).toEqual(AUTOMATION_ARCHITECT_ACTIVATION_POLICY)
        expect(capturedPolicy?.requireSuccessfulSimulation).toBe(true)
        expect(capturedPolicy?.riskPolicy.requireApprovalFor).toEqual(expect.arrayContaining([
            'REVERSIBLE_WRITE',
            'EXTERNAL_COMMUNICATION',
            'SENSITIVE_MUTATION',
            'DESTRUCTIVE',
            'FINANCIAL',
        ]))
    })

    it('publishes the exact ready revision, enables it, and appends an audited success trail', async () => {
        let publishParams: Parameters<ExplicitActivationDependencies['publishExactDraft']>[0] | undefined
        const { service, audits } = setup({
            publishExactDraft: async (params) => {
                publishParams = params
                return published()
            },
        })

        const result = await service.activate(request)

        expect(result.status).toBe('ACTIVATED')
        expect(publishParams).toEqual(expect.objectContaining({
            expectedFlowVersionId: versionId,
            expectedFlowVersionUpdatedAt: versionUpdatedAt,
            actorUserId: userId,
        }))
        expect(audits.map((audit) => audit.event)).toEqual([
            'ATTEMPT_STARTED',
            'PUBLISHED',
            'ACTIVATED',
        ])
        expect(audits.at(-1)).toEqual(expect.objectContaining({
            projectId,
            flowId,
            flowVersionId: versionId,
            flowVersionUpdatedAt: versionUpdatedAt,
            actorUserId: userId,
            approvalId,
            simulationRunId: runId,
            policyDigest: ready.policyDigest,
            riskDigest: ready.riskDigest,
        }))
    })

    it('fails before publishing when activation limits reject the request', async () => {
        let publishedCalled = false
        const { service, audits } = setup({
            checkActivationLimits: async () => {
                throw new Error('active flow limit reached')
            },
            publishExactDraft: async () => {
                publishedCalled = true
                return published()
            },
        })

        const result = await service.activate(request)

        expect(result.status).toBe('FAILED_BEFORE_PUBLISH')
        expect(result.reason).toContain('active flow limit reached')
        expect(publishedCalled).toBe(false)
        expect(audits.map((audit) => audit.event)).toEqual([
            'ATTEMPT_STARTED',
            'FAILED_BEFORE_PUBLISH',
        ])
    })

    it('records a publish failure without attempting enablement', async () => {
        let enableCalled = false
        const { service, audits } = setup({
            publishExactDraft: async () => {
                throw new Error('draft changed after readiness')
            },
            enablePublishedFlow: async () => {
                enableCalled = true
                return published(FlowStatus.ENABLED)
            },
        })

        const result = await service.activate(request)

        expect(result.status).toBe('FAILED_BEFORE_PUBLISH')
        expect(result.reason).toContain('draft changed')
        expect(enableCalled).toBe(false)
        expect(audits.map((audit) => audit.event)).toEqual([
            'ATTEMPT_STARTED',
            'FAILED_BEFORE_PUBLISH',
        ])
    })

    it('returns a recoverable published-but-disabled state when enablement fails', async () => {
        const { service, audits } = setup({
            enablePublishedFlow: async () => {
                throw new Error('trigger activation failed')
            },
        })

        const result = await service.activate(request)

        expect(result.status).toBe('PUBLISHED_NOT_ENABLED')
        expect(result.reason).toContain('trigger activation failed')
        expect(audits.map((audit) => audit.event)).toEqual([
            'ATTEMPT_STARTED',
            'PUBLISHED',
            'PUBLISHED_NOT_ENABLED',
        ])
    })

    it('rejects a publish result that did not publish the exact approved version', async () => {
        const { service, audits } = setup({
            publishExactDraft: async () => ({
                ...published(),
                publishedVersionId: 'vers_other_1234567890',
            }),
        })

        const result = await service.activate(request)

        expect(result.status).toBe('PUBLISHED_NOT_ENABLED')
        expect(result.reason).toContain('exact approved flow version')
        expect(audits.at(-1)?.event).toBe('PUBLISHED_NOT_ENABLED')
    })
})
