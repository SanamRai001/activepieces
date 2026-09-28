import { createHash } from 'node:crypto'
import { type AutomationPolicy, AutomationPolicySchema, type AutomationRiskClass } from '@activepieces/automation-architect'
import { FlowRunStatus, RunEnvironment } from '@activepieces/shared'
import type {
    AutomationActivationApproval,
    AutomationActivationPolicySnapshot,
    AutomationActivationRiskSnapshot,
} from './activation-approval.entity'
import type { AutomationDraftValidationResult } from './draft-validation.service'

export type AutomationActivationReadinessStatus =
    | 'READY_TO_ACTIVATE'
    | 'APPROVAL_REQUIRED'
    | 'DENIED'
    | 'STALE_VALIDATION'
    | 'STALE_APPROVAL'
    | 'SIMULATION_REQUIRED'
    | 'SIMULATION_FAILED'
    | 'NEEDS_CONFIGURATION'
    | 'FLOW_NOT_FOUND'
    | 'UNSAFE_ARTIFACT'

export type AutomationActivationPolicy = {
    riskPolicy: AutomationPolicy
    requireSuccessfulSimulation: boolean
}

export type AutomationSimulationEvidence = {
    runId: string
    flowId: string
    projectId: string
    flowVersionId: string
    environment: RunEnvironment
    status: FlowRunStatus
}

export type AutomationActivationReadinessResult = {
    status: AutomationActivationReadinessStatus
    flowId: string
    flowVersionId?: string
    simulationRunId?: string
    approvalId?: string
    reasons?: string[]
    policySnapshot?: AutomationActivationPolicySnapshot
    riskSnapshot?: AutomationActivationRiskSnapshot[]
    policyDigest?: string
    riskDigest?: string
}

export type EvaluateActivationReadinessParams = {
    flowId: string
    projectId: string
    expectedFlowVersionId: string
    simulationRunId?: string
    policy: AutomationActivationPolicy
    validation: AutomationDraftValidationResult
    simulation?: AutomationSimulationEvidence | null
    riskSnapshot: AutomationActivationRiskSnapshot[]
    approval?: AutomationActivationApproval | null
}

export function evaluateActivationReadiness(
    params: EvaluateActivationReadinessParams,
): AutomationActivationReadinessResult {
    const policyValidation = AutomationPolicySchema.safeParse(params.policy.riskPolicy)
    if (!policyValidation.success) {
        return {
            status: 'DENIED',
            flowId: params.flowId,
            reasons: ['Activation risk policy is invalid or contradictory.'],
        }
    }

    if (typeof params.policy.requireSuccessfulSimulation !== 'boolean') {
        return {
            status: 'DENIED',
            flowId: params.flowId,
            reasons: ['Activation simulation policy is invalid.'],
        }
    }

    const validatedPolicy: AutomationActivationPolicy = {
        ...params.policy,
        riskPolicy: policyValidation.data,
    }

    const validationResult = mapValidation(params.validation)
    if (validationResult !== null) {
        return validationResult
    }

    const currentVersionId = params.validation.flowVersionId
    if (currentVersionId === undefined || currentVersionId !== params.expectedFlowVersionId) {
        return {
            status: 'STALE_VALIDATION',
            flowId: params.flowId,
            flowVersionId: currentVersionId,
            reasons: ['The validated draft version no longer matches the version being considered for activation.'],
        }
    }

    if (validatedPolicy.requireSuccessfulSimulation) {
        if (params.simulationRunId === undefined || params.simulation === null || params.simulation === undefined) {
            return {
                status: 'SIMULATION_REQUIRED',
                flowId: params.flowId,
                flowVersionId: currentVersionId,
                reasons: ['A successful TESTING simulation is required before activation readiness can be established.'],
            }
        }
        const simulationIssue = validateSimulationEvidence({
            evidence: params.simulation,
            flowId: params.flowId,
            projectId: params.projectId,
            flowVersionId: currentVersionId,
            expectedRunId: params.simulationRunId,
        })
        if (simulationIssue !== null) {
            return {
                status: simulationIssue.stale ? 'STALE_VALIDATION' : 'SIMULATION_FAILED',
                flowId: params.flowId,
                flowVersionId: currentVersionId,
                simulationRunId: params.simulationRunId,
                reasons: [simulationIssue.message],
            }
        }
    }

    const normalizedPolicy = normalizePolicy(validatedPolicy)
    const normalizedRisks = normalizeRisks(params.riskSnapshot)
    const denied = new Set(normalizedPolicy.riskPolicy.deny)
    const approvalRequired = new Set(normalizedPolicy.riskPolicy.requireApprovalFor)

    const deniedRisks = uniqueRiskClasses(normalizedRisks)
        .filter((riskClass) => denied.has(riskClass))
    if (deniedRisks.length > 0) {
        return {
            status: 'DENIED',
            flowId: params.flowId,
            flowVersionId: currentVersionId,
            simulationRunId: params.simulationRunId,
            reasons: [`Activation policy denies risk classes: ${deniedRisks.join(', ')}.`],
        }
    }

    const policySnapshot: AutomationActivationPolicySnapshot = normalizedPolicy
    const policyDigest = digest(policySnapshot)
    const riskDigest = digest(normalizedRisks)
    const requiredRiskClasses = uniqueRiskClasses(normalizedRisks)
        .filter((riskClass) => approvalRequired.has(riskClass))

    const common = {
        flowId: params.flowId,
        flowVersionId: currentVersionId,
        simulationRunId: params.simulationRunId,
        policySnapshot,
        riskSnapshot: normalizedRisks,
        policyDigest,
        riskDigest,
    }

    if (requiredRiskClasses.length === 0) {
        return {
            status: 'READY_TO_ACTIVATE',
            ...common,
        }
    }

    if (params.approval === null || params.approval === undefined) {
        return {
            status: 'APPROVAL_REQUIRED',
            ...common,
            reasons: [`Explicit human approval is required for risk classes: ${requiredRiskClasses.join(', ')}.`],
        }
    }

    if (
        params.approval.projectId !== params.projectId
        || params.approval.flowId !== params.flowId
        || params.approval.flowVersionId !== currentVersionId
        || params.approval.policyDigest !== policyDigest
        || params.approval.riskDigest !== riskDigest
        || (
            validatedPolicy.requireSuccessfulSimulation
            && params.approval.simulationRunId !== params.simulationRunId
        )
    ) {
        return {
            status: 'STALE_APPROVAL',
            ...common,
            approvalId: params.approval.id,
            reasons: ['The stored approval does not match the current flow version, policy, or risk snapshot.'],
        }
    }

    return {
        status: 'READY_TO_ACTIVATE',
        ...common,
        approvalId: params.approval.id,
    }
}

function mapValidation(
    validation: AutomationDraftValidationResult,
): AutomationActivationReadinessResult | null {
    switch (validation.status) {
        case 'VALIDATED_DRAFT':
            return null
        case 'FLOW_NOT_FOUND':
            return {
                status: 'FLOW_NOT_FOUND',
                flowId: validation.flowId,
            }
        case 'NEEDS_CONFIGURATION':
            return {
                status: 'NEEDS_CONFIGURATION',
                flowId: validation.flowId,
                flowVersionId: validation.flowVersionId,
                reasons: validation.structural?.issues.map((issue) => issue.message),
            }
        case 'UNSAFE_ARTIFACT':
            return {
                status: 'UNSAFE_ARTIFACT',
                flowId: validation.flowId,
                flowVersionId: validation.flowVersionId,
                reasons: validation.reasons,
            }
    }
}

function validateSimulationEvidence(params: {
    evidence: AutomationSimulationEvidence
    flowId: string
    projectId: string
    flowVersionId: string
    expectedRunId: string
}): { message: string, stale: boolean } | null {
    if (
        params.evidence.runId !== params.expectedRunId
        || params.evidence.flowId !== params.flowId
        || params.evidence.projectId !== params.projectId
    ) {
        return {
            message: 'Simulation evidence does not belong to the requested project/flow/run.',
            stale: true,
        }
    }
    if (params.evidence.flowVersionId !== params.flowVersionId) {
        return {
            message: 'Simulation evidence belongs to a different flow version.',
            stale: true,
        }
    }
    if (params.evidence.environment !== RunEnvironment.TESTING) {
        return {
            message: 'Only TESTING-environment simulation evidence is accepted.',
            stale: false,
        }
    }
    if (params.evidence.status !== FlowRunStatus.SUCCEEDED) {
        return {
            message: `Simulation run must be SUCCEEDED, received ${params.evidence.status}.`,
            stale: false,
        }
    }
    return null
}

export function normalizePolicy(policy: AutomationActivationPolicy): AutomationActivationPolicySnapshot {
    return {
        requireSuccessfulSimulation: policy.requireSuccessfulSimulation,
        riskPolicy: {
            ...policy.riskPolicy,
            requireApprovalFor: [...policy.riskPolicy.requireApprovalFor].sort(),
            deny: [...policy.riskPolicy.deny].sort(),
        },
    }
}

export function normalizeRisks(
    risks: AutomationActivationRiskSnapshot[],
): AutomationActivationRiskSnapshot[] {
    return [...risks]
        .map((risk) => ({ ...risk }))
        .sort((left, right) => {
            return [
                left.stepName,
                left.pieceName,
                left.actionName,
                left.riskClass,
                left.rationale,
            ].join('\u0000').localeCompare([
                right.stepName,
                right.pieceName,
                right.actionName,
                right.riskClass,
                right.rationale,
            ].join('\u0000'))
        })
}

export function digest(value: unknown): string {
    return createHash('sha256')
        .update(canonicalJson(value))
        .digest('hex')
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`
    }
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
            .join(',')}}`
    }
    return JSON.stringify(value)
}

function uniqueRiskClasses(risks: AutomationActivationRiskSnapshot[]): AutomationRiskClass[] {
    return [...new Set(risks.map((risk) => risk.riskClass))].sort()
}
