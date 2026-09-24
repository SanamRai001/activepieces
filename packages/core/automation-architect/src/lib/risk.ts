import { z } from 'zod'

export const AutomationRiskClassSchema = z.enum([
    'READ_ONLY',
    'REVERSIBLE_WRITE',
    'EXTERNAL_COMMUNICATION',
    'SENSITIVE_MUTATION',
    'DESTRUCTIVE',
    'FINANCIAL',
])

export type AutomationRiskClass = z.infer<typeof AutomationRiskClassSchema>

export const AutomationRiskSchema = z.object({
    class: AutomationRiskClassSchema,
    rationale: z.string().trim().min(1),
}).strict()

export type AutomationRisk = z.infer<typeof AutomationRiskSchema>
