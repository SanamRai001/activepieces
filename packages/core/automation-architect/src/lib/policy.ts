import { z } from 'zod'
import { AutomationRiskClassSchema } from './risk'

export const AutomationPolicySchema = z.object({
    requireApprovalFor: z.array(AutomationRiskClassSchema),
    deny: z.array(AutomationRiskClassSchema).default([]),
    maxAttemptsPerStep: z.number().int().min(1).max(20).default(3),
}).strict().superRefine((policy, ctx) => {
    const denied = new Set(policy.deny)
    policy.requireApprovalFor.forEach((riskClass, index) => {
        if (denied.has(riskClass)) {
            ctx.addIssue({
                code: 'custom',
                path: ['requireApprovalFor', index],
                message: `Risk class ${riskClass} cannot be both denied and approval-gated.`,
            })
        }
    })
})

export type AutomationPolicy = z.infer<typeof AutomationPolicySchema>

export const PolicyDecisionSchema = z.enum([
    'ALLOW',
    'REQUIRE_APPROVAL',
    'DENY',
])

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>

export const PolicyEvaluationSchema = z.object({
    stepId: z.string().trim().min(1),
    decision: PolicyDecisionSchema,
    reason: z.string().trim().min(1),
}).strict()

export type PolicyEvaluation = z.infer<typeof PolicyEvaluationSchema>
