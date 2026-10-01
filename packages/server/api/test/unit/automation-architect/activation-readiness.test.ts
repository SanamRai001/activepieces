import type { AutomationPolicy } from '@activepieces/automation-architect'
import { FlowRunStatus, RunEnvironment } from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import type { AutomationActivationApproval, AutomationActivationRiskSnapshot } from '../../../src/app/automation-architect/activation-approval.entity'
import {
    type AutomationActivationPolicy,
    evaluateActivationReadiness,
} from '../../../src/app/automation-architect/activation-readiness'
import { createActivationReadinessService } from '../../../src/app/automation-architect/activation-readiness.service'
import type { AutomationDraftValidationResult } from '../../../src/app/automation-architect/draft-validation.service'

const flowId = 'flow_1234567890123456'
const projectId = 'proj_1234567890123456'
const versionId = 'vers_1234567890123456'
const versionUpdatedAt = '2026-09-25T00:00:00.000Z'
const simulationCreatedAt = '2026-09-25T00:01:00.000Z'
const runId = 'run__1234567890123456'
const userId = 'user_1234567890123456'

const baseRiskPolicy: AutomationPolicy = {
    requireApprovalFor: ['SENSITIVE_MUTATION', 'DESTRUCTIVE', 'FINANCIAL', 'EXTERNAL_COMMUNICATION'],
    deny: [],
    maxAttemptsPerStep: 3,
}

const policy: AutomationActivationPolicy = {
    riskPolicy: baseRiskPolicy,
    requireSuccessfulSimulation: true,
}

const validation: AutomationDraftValidationResult = {
    status: 'VALIDATED_DRAFT',
    flowId,
    flowVersionId: versionId,
    flowVersionUpdatedAt: versionUpdatedAt,
}

const simulation = {
    runId,
    flowId,
    projectId,
    flowVersionId: versionId,
    createdAt: simulationCreatedAt,
    environment: RunEnvironment.TESTING,
    status: FlowRunStatus.SUCCEEDED,
}

const writeRisk: AutomationActivationRiskSnapshot[] = [{
    stepName: 'aa_step_001',
    pieceName: '@activepieces/piece-example',
    actionName: 'write',
    riskClass: 'SENSITIVE_MUTATION',
    rationale: 'Activepieces classifies this action as WRITE.',
}]

const readRisk: AutomationActivationRiskSnapshot[] = [{
    stepName: 'aa_step_001',
    pieceName: '@activepieces/piece-example',
    actionName: 'read',
    riskClass: 'READ_ONLY',
    rationale: 'Activepieces classifies this action as READ.',
}]

describe('activation readiness evaluator', () => {
    it('is ready without approval for risks not gated by policy', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            validation,
            simulation,
            riskSnapshot: readRisk,
            approval: null,
        })
        expect(result.status).toBe('READY_TO_ACTIVATE')
    })

    it('requires approval for configured high-impact risk', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            validation,
            simulation,
            riskSnapshot: writeRisk,
            approval: null,
        })
        expect(result.status).toBe('APPROVAL_REQUIRED')
        expect(result.policyDigest).toHaveLength(64)
        expect(result.riskDigest).toHaveLength(64)
    })

    it('fails closed for contradictory activation policy', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy: {
                ...policy,
                riskPolicy: {
                    ...baseRiskPolicy,
                    requireApprovalFor: ['DESTRUCTIVE'],
                    deny: ['DESTRUCTIVE'],
                },
            },
            validation,
            simulation,
            riskSnapshot: writeRisk,
            approval: null,
        })
        expect(result.status).toBe('DENIED')
        expect(result.reasons?.[0]).toContain('policy is invalid')
    })

    it('denies risk classes forbidden by policy', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy: {
                ...policy,
                riskPolicy: {
                    ...baseRiskPolicy,
                    requireApprovalFor: [],
                    deny: ['DESTRUCTIVE'],
                },
            },
            validation,
            simulation,
            riskSnapshot: [{
                ...writeRisk[0],
                riskClass: 'DESTRUCTIVE',
            }],
            approval: null,
        })
        expect(result.status).toBe('DENIED')
    })

    it('rejects a changed draft version as stale validation', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: 'vers_old_123456789012',
            simulationRunId: runId,
            policy,
            validation,
            simulation,
            riskSnapshot: writeRisk,
            approval: null,
        })
        expect(result.status).toBe('STALE_VALIDATION')
    })

    it('requires simulation evidence when policy requires it', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            policy,
            validation,
            simulation: null,
            riskSnapshot: readRisk,
            approval: null,
        })
        expect(result.status).toBe('SIMULATION_REQUIRED')
    })

    it('rejects simulation from another flow version', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            validation,
            simulation: {
                ...simulation,
                flowVersionId: 'vers_other_1234567890',
            },
            riskSnapshot: readRisk,
            approval: null,
        })
        expect(result.status).toBe('STALE_VALIDATION')
    })

    it('rejects non-testing simulation evidence', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            validation,
            simulation: {
                ...simulation,
                environment: RunEnvironment.PRODUCTION,
            },
            riskSnapshot: readRisk,
            approval: null,
        })
        expect(result.status).toBe('SIMULATION_FAILED')
    })

    it('rejects unsuccessful simulation evidence', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            validation,
            simulation: {
                ...simulation,
                status: FlowRunStatus.FAILED,
            },
            riskSnapshot: readRisk,
            approval: null,
        })
        expect(result.status).toBe('SIMULATION_FAILED')
    })

    it('accepts an exact version/policy/risk approval', () => {
        const pending = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            validation,
            simulation,
            riskSnapshot: writeRisk,
            approval: null,
        })
        expect(pending.status).toBe('APPROVAL_REQUIRED')

        const approval: AutomationActivationApproval = {
            id: 'appr_1234567890123456',
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            projectId,
            flowId,
            flowVersionId: versionId,
            flowVersionUpdatedAt: versionUpdatedAt,
            approvedByUserId: userId,
            approvedAt: new Date().toISOString(),
            simulationRunId: runId,
            policySnapshot: pending.policySnapshot!,
            riskSnapshot: pending.riskSnapshot!,
            policyDigest: pending.policyDigest!,
            riskDigest: pending.riskDigest!,
        }

        const ready = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            validation,
            simulation,
            riskSnapshot: writeRisk,
            approval,
        })
        expect(ready.status).toBe('READY_TO_ACTIVATE')
        expect(ready.approvalId).toBe(approval.id)
    })

    it('marks approval stale when the flow version changes but validation is fresh', () => {
        const previousApproval = makeApproval(policy, writeRisk)
        const newVersionId = 'vers_new__12345678901'
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: newVersionId,
            simulationRunId: 'run_new__12345678901',
            policy,
            validation: {
                status: 'VALIDATED_DRAFT',
                flowId,
                flowVersionId: newVersionId,
                flowVersionUpdatedAt: versionUpdatedAt,
            },
            simulation: {
                ...simulation,
                runId: 'run_new__12345678901',
                flowVersionId: newVersionId,
            },
            riskSnapshot: writeRisk,
            approval: previousApproval,
        })
        expect(result.status).toBe('STALE_APPROVAL')
    })

    it('marks approval stale when the required simulation evidence changes', () => {
        const approval = makeApproval(policy, writeRisk)
        const differentRunId = 'run_other_1234567890'
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: differentRunId,
            policy,
            validation,
            simulation: {
                ...simulation,
                runId: differentRunId,
            },
            riskSnapshot: writeRisk,
            approval,
        })
        expect(result.status).toBe('STALE_APPROVAL')
    })

    it('marks approval stale when policy changes', () => {
        const approval = makeApproval(policy, writeRisk)
        const changedPolicy: AutomationActivationPolicy = {
            ...policy,
            riskPolicy: {
                ...policy.riskPolicy,
                requireApprovalFor: ['SENSITIVE_MUTATION', 'DESTRUCTIVE'],
            },
        }
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy: changedPolicy,
            validation,
            simulation,
            riskSnapshot: writeRisk,
            approval,
        })
        expect(result.status).toBe('STALE_APPROVAL')
    })

    it('marks approval stale when the draft changes in place with the same version id', () => {
        const approval = makeApproval(policy, writeRisk)
        const changedUpdatedAt = '2026-09-25T00:02:00.000Z'
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            validation: {
                ...validation,
                flowVersionUpdatedAt: changedUpdatedAt,
            },
            simulation: {
                ...simulation,
                createdAt: '2026-09-25T00:03:00.000Z',
            },
            riskSnapshot: writeRisk,
            approval,
        })
        expect(result.status).toBe('STALE_APPROVAL')
    })

    it('rejects simulation evidence that predates the current draft revision', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            validation: {
                ...validation,
                flowVersionUpdatedAt: '2026-09-25T00:05:00.000Z',
            },
            simulation: {
                ...simulation,
                createdAt: '2026-09-25T00:04:00.000Z',
            },
            riskSnapshot: readRisk,
            approval: null,
        })
        expect(result.status).toBe('STALE_VALIDATION')
    })

    it('applies schema defaults to runtime activation policy', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy: {
                riskPolicy: {
                    requireApprovalFor: [],
                    maxAttemptsPerStep: 3,
                } as AutomationPolicy,
                requireSuccessfulSimulation: true,
            },
            validation,
            simulation,
            riskSnapshot: readRisk,
            approval: null,
        })
        expect(result.status).toBe('READY_TO_ACTIVATE')
        expect(result.policySnapshot?.riskPolicy.deny).toEqual([])
    })

    it('maps unsafe structural validation directly', () => {
        const result = evaluateActivationReadiness({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            policy,
            validation: {
                status: 'UNSAFE_ARTIFACT',
                flowId,
                reasons: ['enabled'],
            },
            simulation: null,
            riskSnapshot: [],
            approval: null,
        })
        expect(result.status).toBe('UNSAFE_ARTIFACT')
    })
})

describe('activation readiness service', () => {
    it('creates immutable approval evidence then returns ready', async () => {
        let stored: AutomationActivationApproval | null = null
        const service = createActivationReadinessService({
            validateDraft: async () => validation,
            getSimulation: async () => simulation,
            resolveRisks: async () => writeRisk,
            getLatestApproval: async () => stored,
            saveApproval: async (record) => {
                stored = {
                    ...record,
                    created: new Date().toISOString(),
                    updated: new Date().toISOString(),
                }
                return stored
            },
        })

        const result = await service.approve({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
            approvedByUserId: userId,
        })

        expect(result.status).toBe('READY_TO_ACTIVATE')
        expect(stored?.flowVersionId).toBe(versionId)
        expect(stored?.flowVersionUpdatedAt).toBe(versionUpdatedAt)
        expect(stored?.approvedByUserId).toBe(userId)
        expect(stored?.policyDigest).toHaveLength(64)
        expect(stored?.riskDigest).toHaveLength(64)
    })

    it('does not create approval when policy denies activation', async () => {
        let saved = false
        const service = createActivationReadinessService({
            validateDraft: async () => validation,
            getSimulation: async () => simulation,
            resolveRisks: async () => [{
                ...writeRisk[0],
                riskClass: 'DESTRUCTIVE',
            }],
            getLatestApproval: async () => null,
            saveApproval: async () => {
                saved = true
                throw new Error('must not save')
            },
        })

        const result = await service.approve({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy: {
                ...policy,
                riskPolicy: {
                    ...policy.riskPolicy,
                    requireApprovalFor: [],
                    deny: ['DESTRUCTIVE'],
                },
            },
            approvedByUserId: userId,
        })

        expect(result.status).toBe('DENIED')
        expect(saved).toBe(false)
    })

    it('fails closed when authoritative risk resolution fails', async () => {
        const service = createActivationReadinessService({
            validateDraft: async () => validation,
            getSimulation: async () => simulation,
            resolveRisks: async () => {
                throw new Error('piece metadata missing')
            },
            getLatestApproval: async () => null,
            saveApproval: async () => {
                throw new Error('unused')
            },
        })

        const result = await service.assess({
            flowId,
            projectId,
            expectedFlowVersionId: versionId,
            simulationRunId: runId,
            policy,
        })

        expect(result.status).toBe('DENIED')
        expect(result.reasons?.[0]).toContain('risk resolution failed')
    })
})

function makeApproval(
    approvalPolicy: AutomationActivationPolicy,
    risks: AutomationActivationRiskSnapshot[],
): AutomationActivationApproval {
    const pending = evaluateActivationReadiness({
        flowId,
        projectId,
        expectedFlowVersionId: versionId,
        simulationRunId: runId,
        policy: approvalPolicy,
        validation,
        simulation,
        riskSnapshot: risks,
        approval: null,
    })
    return {
        id: 'appr_1234567890123456',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        projectId,
        flowId,
        flowVersionId: versionId,
        flowVersionUpdatedAt: versionUpdatedAt,
        approvedByUserId: userId,
        approvedAt: new Date().toISOString(),
        simulationRunId: runId,
        policySnapshot: pending.policySnapshot!,
        riskSnapshot: pending.riskSnapshot!,
        policyDigest: pending.policyDigest!,
        riskDigest: pending.riskDigest!,
    }
}
