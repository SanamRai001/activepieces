import { z } from 'zod'

export const AutomationReferenceSchema = z.discriminatedUnion('source', [
    z.object({
        kind: z.literal('REFERENCE'),
        source: z.literal('TRIGGER'),
        path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    }).strict(),
    z.object({
        kind: z.literal('REFERENCE'),
        source: z.literal('STEP'),
        stepId: z.string().trim().min(1),
        path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    }).strict(),
])

export type AutomationReference = z.infer<typeof AutomationReferenceSchema>

export type AutomationValue =
    | string
    | number
    | boolean
    | null
    | AutomationReference
    | AutomationValue[]
    | { [key: string]: AutomationValue }

export const AutomationValueSchema: z.ZodType<AutomationValue> = z.lazy(() => {
    const plainObjectSchema = z.record(z.string(), AutomationValueSchema).superRefine((value, ctx) => {
        if (value.kind === 'REFERENCE') {
            ctx.addIssue({
                code: 'custom',
                path: ['kind'],
                message: 'Objects with kind="REFERENCE" must match the AutomationReference schema.',
            })
        }
    })

    return z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        AutomationReferenceSchema,
        z.array(AutomationValueSchema),
        plainObjectSchema,
    ])
})

export const AutomationInputSchema = z.record(z.string(), AutomationValueSchema)

export type AutomationInput = z.infer<typeof AutomationInputSchema>
