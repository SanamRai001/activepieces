import {
    AutomationIrV1,
    AutomationIrV1Schema,
    AutomationStep,
    LATEST_AUTOMATION_IR_VERSION,
} from './automation-ir'
import {
    AutomationPlannerInput,
    AutomationPlannerInputSchema,
    AutomationPlannerModel,
    AutomationPlannerResult,
    PlannerDiagnostic,
    PlannerModelResponseSchema,
    PlannerQuestion,
} from './planner-contract'
import { PlannerCapability, PlannerCapabilityKind } from './planner-capability'

export class NaturalLanguageAutomationPlanner {
    constructor(private readonly model: AutomationPlannerModel) {}

    async plan(input: unknown): Promise<AutomationPlannerResult> {
        const parsedInput = AutomationPlannerInputSchema.safeParse(input)
        if (!parsedInput.success) {
            return {
                status: 'FAILED',
                diagnostics: [{
                    code: 'INVALID_INPUT',
                    severity: 'ERROR',
                    message: formatIssues(parsedInput.error.issues.map((issue) => issue.message)),
                }],
            }
        }

        let rawModelResponse: unknown
        try {
            rawModelResponse = await this.model.generatePlan({
                ...parsedInput.data,
                irSchemaVersion: LATEST_AUTOMATION_IR_VERSION,
            })
        }
        catch (error) {
            return {
                status: 'FAILED',
                diagnostics: [{
                    code: 'MODEL_FAILURE',
                    severity: 'ERROR',
                    message: error instanceof Error
                        ? `Planner model failed: ${error.message}`
                        : 'Planner model failed with an unknown error.',
                }],
            }
        }

        const parsedModelResponse = PlannerModelResponseSchema.safeParse(rawModelResponse)
        if (!parsedModelResponse.success) {
            return {
                status: 'FAILED',
                diagnostics: [{
                    code: 'MODEL_OUTPUT_INVALID',
                    severity: 'ERROR',
                    message: formatIssues(parsedModelResponse.error.issues.map((issue) => issue.message)),
                }],
            }
        }

        if (parsedModelResponse.data.status === 'NEEDS_INPUT') {
            return {
                status: 'NEEDS_INPUT',
                questions: parsedModelResponse.data.questions,
                explanation: parsedModelResponse.data.explanation,
                diagnostics: [],
            }
        }

        const parsedAutomation = AutomationIrV1Schema.safeParse(parsedModelResponse.data.automation)
        if (!parsedAutomation.success) {
            return {
                status: 'FAILED',
                diagnostics: [{
                    code: 'INVALID_AUTOMATION_IR',
                    severity: 'ERROR',
                    message: formatIssues(parsedAutomation.error.issues.map((issue) => issue.message)),
                }],
            }
        }

        const grounding = groundAutomation(
            parsedAutomation.data,
            parsedInput.data,
        )

        if (grounding.fatalDiagnostics.length > 0) {
            return {
                status: 'FAILED',
                diagnostics: grounding.diagnostics,
            }
        }

        if (grounding.connectionQuestions.length > 0) {
            return {
                status: 'NEEDS_INPUT',
                questions: grounding.connectionQuestions,
                explanation: parsedModelResponse.data.explanation,
                diagnostics: grounding.diagnostics,
            }
        }

        return {
            status: 'READY',
            automation: grounding.automation,
            explanation: parsedModelResponse.data.explanation,
            assumptions: parsedModelResponse.data.assumptions,
            diagnostics: grounding.diagnostics,
        }
    }
}

type GroundingResult = {
    automation: AutomationIrV1
    diagnostics: PlannerDiagnostic[]
    fatalDiagnostics: PlannerDiagnostic[]
    connectionQuestions: PlannerQuestion[]
}

function groundAutomation(
    automation: AutomationIrV1,
    input: AutomationPlannerInput,
): GroundingResult {
    const capabilityById = new Map(
        input.capabilities.map((capability) => [capability.id, capability]),
    )
    const diagnostics: PlannerDiagnostic[] = []
    const connectionQuestions: PlannerQuestion[] = []

    if (automation.trigger.type === 'EVENT') {
        validateCapabilityUse({
            capabilityId: automation.trigger.capability,
            expectedKind: 'TRIGGER',
            capabilityById,
            policy: input.policy,
            diagnostics,
            connectionQuestions,
        })
    }

    const normalizedSteps: AutomationStep[] = automation.steps.map((step) => {
        if (step.type !== 'ACTION' && step.type !== 'NOTIFICATION') {
            return step
        }

        const expectedKind: PlannerCapabilityKind = step.type === 'ACTION'
            ? 'ACTION'
            : 'NOTIFICATION'

        const capability = validateCapabilityUse({
            capabilityId: step.capability,
            expectedKind,
            capabilityById,
            policy: input.policy,
            diagnostics,
            connectionQuestions,
            stepId: step.id,
        })

        if (capability?.risk === undefined) {
            return step
        }

        return {
            ...step,
            risk: capability.risk,
        }
    })

    const fatalDiagnostics = diagnostics.filter((diagnostic) =>
        diagnostic.code === 'UNKNOWN_CAPABILITY'
        || diagnostic.code === 'CAPABILITY_KIND_MISMATCH'
        || diagnostic.code === 'POLICY_DENIED',
    )

    return {
        automation: {
            ...automation,
            steps: normalizedSteps,
        },
        diagnostics,
        fatalDiagnostics,
        connectionQuestions: deduplicateQuestions(connectionQuestions),
    }
}

type ValidateCapabilityUseParams = {
    capabilityId: string
    expectedKind: PlannerCapabilityKind
    capabilityById: Map<string, PlannerCapability>
    policy: AutomationPlannerInput['policy']
    diagnostics: PlannerDiagnostic[]
    connectionQuestions: PlannerQuestion[]
    stepId?: string
}

function validateCapabilityUse(
    params: ValidateCapabilityUseParams,
): PlannerCapability | undefined {
    const capability = params.capabilityById.get(params.capabilityId)

    if (capability === undefined) {
        params.diagnostics.push({
            code: 'UNKNOWN_CAPABILITY',
            severity: 'ERROR',
            message: `Planner selected unavailable capability "${params.capabilityId}".`,
            capabilityId: params.capabilityId,
            stepId: params.stepId,
        })
        return undefined
    }

    if (capability.kind !== params.expectedKind) {
        params.diagnostics.push({
            code: 'CAPABILITY_KIND_MISMATCH',
            severity: 'ERROR',
            message: `Capability "${capability.id}" is ${capability.kind}, but this location requires ${params.expectedKind}.`,
            capabilityId: capability.id,
            stepId: params.stepId,
        })
        return capability
    }

    if (capability.connection.required && !capability.connection.available) {
        params.diagnostics.push({
            code: 'CONNECTION_REQUIRED',
            severity: 'WARNING',
            message: `Capability "${capability.name}" requires a connection that is not currently available.`,
            capabilityId: capability.id,
            stepId: params.stepId,
        })
        params.connectionQuestions.push({
            id: `connect:${capability.id}`,
            question: `Connect "${capability.name}" before continuing.`,
            reason: capability.connection.label !== undefined
                ? `This automation requires the ${capability.connection.label} connection.`
                : `This automation requires a connection for capability "${capability.id}".`,
        })
    }

    const effectiveRisk = capability.risk
    if (effectiveRisk === undefined) {
        return capability
    }

    if (params.policy.deny.includes(effectiveRisk.class)) {
        params.diagnostics.push({
            code: 'POLICY_DENIED',
            severity: 'ERROR',
            message: `Policy denies ${effectiveRisk.class} operations required by "${capability.name}".`,
            capabilityId: capability.id,
            stepId: params.stepId,
        })
        return capability
    }

    if (params.policy.requireApprovalFor.includes(effectiveRisk.class)) {
        params.diagnostics.push({
            code: 'POLICY_APPROVAL_REQUIRED',
            severity: 'INFO',
            message: `"${capability.name}" requires human approval before execution because it is classified as ${effectiveRisk.class}.`,
            capabilityId: capability.id,
            stepId: params.stepId,
        })
    }

    return capability
}

function deduplicateQuestions(questions: PlannerQuestion[]): PlannerQuestion[] {
    const seen = new Set<string>()
    return questions.filter((question) => {
        if (seen.has(question.id)) {
            return false
        }
        seen.add(question.id)
        return true
    })
}

function formatIssues(messages: string[]): string {
    return messages.length === 1
        ? messages[0]
        : messages.map((message, index) => `${index + 1}. ${message}`).join(' ')
}
