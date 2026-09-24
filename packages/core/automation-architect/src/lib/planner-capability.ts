import { z } from 'zod'
import { AutomationRiskSchema } from './risk'

export const PlannerCapabilityKindSchema = z.enum([
    'TRIGGER',
    'ACTION',
    'NOTIFICATION',
])

export type PlannerCapabilityKind = z.infer<typeof PlannerCapabilityKindSchema>

export const PlannerCapabilityConnectionSchema = z.object({
    required: z.boolean(),
    available: z.boolean(),
    label: z.string().trim().min(1).max(200).optional(),
}).strict()

export type PlannerCapabilityConnection = z.infer<typeof PlannerCapabilityConnectionSchema>

export const PlannerCapabilitySchema = z.object({
    id: z.string().trim().min(1).max(200),
    kind: PlannerCapabilityKindSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    connection: PlannerCapabilityConnectionSchema.default({
        required: false,
        available: true,
    }),
    risk: AutomationRiskSchema.optional(),
}).strict()

export type PlannerCapability = z.infer<typeof PlannerCapabilitySchema>
