import { z } from 'zod'
import { AutomationIrV1 } from './automation-ir'
import { AutomationPolicySchema } from './policy'
import { PlannerCapabilitySchema } from './planner-capability'

export const AutomationPlannerInputSchema = z.object({
    goal: z.string().trim().min(1).max(8000),
    capabilities: z.array(PlannerCapabilitySchema).min(1).max(1000),
    policy: AutomationPolicySchema,
    constraints: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
}).strict().superRefine((input, ctx) => {
    const seen = new Set<string>()

    input.capabilities.forEach((capability, index) => {
        if (seen.has(capability.id)) {
            ctx.addIssue({
                code: 'custom',
                path: ['capabilities', index, 'id'],
                message: `Duplicate capability id: ${capability.id}`,
            })
        }
        seen.add(capability.id)
    })
})

export type AutomationPlannerInput = z.infer<typeof AutomationPlannerInputSchema>

export const PlannerQuestionSchema = z.object({
    id: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(2000),
    reason: z.string().trim().min(1).max(2000),
}).strict()

export type PlannerQuestion = z.infer<typeof PlannerQuestionSchema>

const PlannerModelReadyResponseSchema = z.object({
    status: z.literal('READY'),
    automation: z.unknown(),
    explanation: z.string().trim().min(1).max(8000),
    assumptions: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
}).strict()

const PlannerModelNeedsInputResponseSchema = z.object({
    status: z.literal('NEEDS_INPUT'),
    questions: z.array(PlannerQuestionSchema).min(1).max(10),
    explanation: z.string().trim().min(1).max(8000).optional(),
}).strict()

export const PlannerModelResponseSchema = z.discriminatedUnion('status', [
    PlannerModelReadyResponseSchema,
    PlannerModelNeedsInputResponseSchema,
])

export type PlannerModelResponse = z.infer<typeof PlannerModelResponseSchema>

export const PlannerDiagnosticCodeSchema = z.enum([
    'INVALID_INPUT',
    'MODEL_FAILURE',
    'MODEL_OUTPUT_INVALID',
    'INVALID_AUTOMATION_IR',
    'UNKNOWN_CAPABILITY',
    'CAPABILITY_KIND_MISMATCH',
    'CONNECTION_REQUIRED',
    'POLICY_APPROVAL_REQUIRED',
    'POLICY_DENIED',
])

export type PlannerDiagnosticCode = z.infer<typeof PlannerDiagnosticCodeSchema>

export const PlannerDiagnosticSeveritySchema = z.enum([
    'INFO',
    'WARNING',
    'ERROR',
])

export type PlannerDiagnosticSeverity = z.infer<typeof PlannerDiagnosticSeveritySchema>

export const PlannerDiagnosticSchema = z.object({
    code: PlannerDiagnosticCodeSchema,
    severity: PlannerDiagnosticSeveritySchema,
    message: z.string().trim().min(1),
    stepId: z.string().trim().min(1).optional(),
    capabilityId: z.string().trim().min(1).optional(),
}).strict()

export type PlannerDiagnostic = z.infer<typeof PlannerDiagnosticSchema>

export type PlannerReadyResult = {
    status: 'READY'
    automation: AutomationIrV1
    explanation: string
    assumptions: string[]
    diagnostics: PlannerDiagnostic[]
}

export type PlannerNeedsInputResult = {
    status: 'NEEDS_INPUT'
    questions: PlannerQuestion[]
    explanation?: string
    diagnostics: PlannerDiagnostic[]
}

export type PlannerFailedResult = {
    status: 'FAILED'
    diagnostics: PlannerDiagnostic[]
}

export type AutomationPlannerResult =
    | PlannerReadyResult
    | PlannerNeedsInputResult
    | PlannerFailedResult

export type PlannerModelInput = AutomationPlannerInput & {
    irSchemaVersion: '1'
}

export interface AutomationPlannerModel {
    generatePlan(input: PlannerModelInput): Promise<unknown>
}
