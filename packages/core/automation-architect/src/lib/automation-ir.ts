import { z } from 'zod'
import { AutomationInputSchema, AutomationReference, AutomationValue, AutomationValueSchema } from './automation-value'
import { AutomationRiskSchema } from './risk'

export const LATEST_AUTOMATION_IR_VERSION = '1' as const

export const AutomationStepIdSchema = z.string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'Step ids must start with a letter and contain only letters, numbers, "_" or "-".')

export const AutomationCapabilitySchema = z.string().trim().min(1).max(200)

const AutomationControlTargetSchema = AutomationStepIdSchema

const baseTriggerShape = {
    next: AutomationControlTargetSchema.optional(),
}

export const ManualTriggerSchema = z.object({
    type: z.literal('MANUAL'),
    ...baseTriggerShape,
}).strict()

export const ScheduleTriggerSchema = z.object({
    type: z.literal('SCHEDULE'),
    cron: z.string().trim().min(1),
    timezone: z.string().trim().min(1).optional(),
    ...baseTriggerShape,
}).strict()

export const EventTriggerSchema = z.object({
    type: z.literal('EVENT'),
    capability: AutomationCapabilitySchema,
    input: AutomationInputSchema.default({}),
    ...baseTriggerShape,
}).strict()

export const AutomationTriggerSchema = z.discriminatedUnion('type', [
    ManualTriggerSchema,
    ScheduleTriggerSchema,
    EventTriggerSchema,
])

export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>

const commonStepShape = {
    id: AutomationStepIdSchema,
    name: z.string().trim().min(1).max(200),
    risk: AutomationRiskSchema.optional(),
}

const nextShape = {
    next: AutomationControlTargetSchema.optional(),
}

export const ActionStepSchema = z.object({
    ...commonStepShape,
    type: z.literal('ACTION'),
    capability: AutomationCapabilitySchema,
    input: AutomationInputSchema.default({}),
    ...nextShape,
}).strict()

const unaryConditionOperators = new Set([
    'EXISTS',
    'NOT_EXISTS',
    'IS_TRUE',
    'IS_FALSE',
])

export const ConditionOperatorSchema = z.enum([
    'EQUALS',
    'NOT_EQUALS',
    'GREATER_THAN',
    'GREATER_THAN_OR_EQUAL',
    'LESS_THAN',
    'LESS_THAN_OR_EQUAL',
    'CONTAINS',
    'NOT_CONTAINS',
    'EXISTS',
    'NOT_EXISTS',
    'IS_TRUE',
    'IS_FALSE',
])

export const ConditionExpressionSchema = z.object({
    left: AutomationValueSchema,
    operator: ConditionOperatorSchema,
    right: AutomationValueSchema.optional(),
}).strict().superRefine((expression, ctx) => {
    const unary = unaryConditionOperators.has(expression.operator)
    if (unary && expression.right !== undefined) {
        ctx.addIssue({
            code: 'custom',
            path: ['right'],
            message: `Operator ${expression.operator} does not accept a right-hand value.`,
        })
    }
    if (!unary && expression.right === undefined) {
        ctx.addIssue({
            code: 'custom',
            path: ['right'],
            message: `Operator ${expression.operator} requires a right-hand value.`,
        })
    }
})

export const ConditionStepSchema = z.object({
    ...commonStepShape,
    type: z.literal('CONDITION'),
    expression: ConditionExpressionSchema,
    ifTrue: AutomationControlTargetSchema.optional(),
    ifFalse: AutomationControlTargetSchema.optional(),
}).strict()

export const AiDecisionRouteSchema = z.object({
    key: z.string().trim().min(1).max(64),
    description: z.string().trim().min(1).max(1000),
    next: AutomationControlTargetSchema.optional(),
}).strict()

export const AiDecisionStepSchema = z.object({
    ...commonStepShape,
    type: z.literal('AI_DECISION'),
    instruction: z.string().trim().min(1).max(8000),
    input: AutomationInputSchema.default({}),
    routes: z.array(AiDecisionRouteSchema).min(1).max(20),
    fallback: AutomationControlTargetSchema.optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
}).strict().superRefine((step, ctx) => {
    const seen = new Set<string>()
    step.routes.forEach((route, index) => {
        const key = route.key.toLowerCase()
        if (seen.has(key)) {
            ctx.addIssue({
                code: 'custom',
                path: ['routes', index, 'key'],
                message: `Duplicate AI decision route key: ${route.key}`,
            })
        }
        seen.add(key)
    })
})

export const ApprovalGateStepSchema = z.object({
    ...commonStepShape,
    type: z.literal('APPROVAL_GATE'),
    prompt: AutomationValueSchema,
    onApproved: AutomationControlTargetSchema.optional(),
    onRejected: AutomationControlTargetSchema.optional(),
}).strict()

export const NotificationStepSchema = z.object({
    ...commonStepShape,
    type: z.literal('NOTIFICATION'),
    capability: AutomationCapabilitySchema,
    input: AutomationInputSchema.default({}),
    ...nextShape,
}).strict()

export const AutomationStepSchema = z.discriminatedUnion('type', [
    ActionStepSchema,
    ConditionStepSchema,
    AiDecisionStepSchema,
    ApprovalGateStepSchema,
    NotificationStepSchema,
])

export type AutomationStep = z.infer<typeof AutomationStepSchema>

export const AutomationIrV1Schema = z.object({
    schemaVersion: z.literal(LATEST_AUTOMATION_IR_VERSION),
    name: z.string().trim().min(1).max(200),
    goal: z.string().trim().min(1).max(4000),
    trigger: AutomationTriggerSchema,
    steps: z.array(AutomationStepSchema).min(1).max(500),
}).strict().superRefine((automation, ctx) => {
    const stepIds = new Set<string>()

    automation.steps.forEach((step, index) => {
        if (stepIds.has(step.id)) {
            ctx.addIssue({
                code: 'custom',
                path: ['steps', index, 'id'],
                message: `Duplicate step id: ${step.id}`,
            })
        }
        stepIds.add(step.id)
    })

    if (automation.trigger.next === undefined) {
        ctx.addIssue({
            code: 'custom',
            path: ['trigger', 'next'],
            message: 'A V1 automation with steps must identify the first step using trigger.next.',
        })
    }

    const validateTarget = (target: string | undefined, path: (string | number)[]): void => {
        if (target !== undefined && !stepIds.has(target)) {
            ctx.addIssue({
                code: 'custom',
                path,
                message: `Unknown target step: ${target}`,
            })
        }
    }

    validateTarget(automation.trigger.next, ['trigger', 'next'])

    automation.steps.forEach((step, index) => {
        for (const target of controlTargets(step)) {
            validateTarget(target.value, ['steps', index, ...target.path])
        }

        for (const reference of collectStepReferences(step)) {
            if (!stepIds.has(reference.stepId)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['steps', index],
                    message: `Step "${step.id}" references unknown step "${reference.stepId}".`,
                })
            }
        }
    })

    if (automation.trigger.type === 'EVENT') {
        for (const reference of collectReferences(automation.trigger.input)) {
            if (reference.source === 'STEP') {
                ctx.addIssue({
                    code: 'custom',
                    path: ['trigger', 'input'],
                    message: 'Trigger input cannot reference step output because no step has executed yet.',
                })
            }
        }
    }

    if (automation.trigger.next === undefined || !stepIds.has(automation.trigger.next)) {
        return
    }

    const adjacency = new Map<string, string[]>()
    automation.steps.forEach((step) => {
        adjacency.set(
            step.id,
            controlTargets(step)
                .map((target) => target.value)
                .filter((target): target is string => target !== undefined && stepIds.has(target)),
        )
    })

    const reachable = new Set<string>()
    const visiting = new Set<string>()
    const visited = new Set<string>()
    let cycleFound = false

    const visit = (stepId: string): void => {
        if (visiting.has(stepId)) {
            cycleFound = true
            return
        }
        if (visited.has(stepId)) {
            return
        }

        visiting.add(stepId)
        reachable.add(stepId)

        for (const target of adjacency.get(stepId) ?? []) {
            visit(target)
        }

        visiting.delete(stepId)
        visited.add(stepId)
    }

    visit(automation.trigger.next)

    if (cycleFound) {
        ctx.addIssue({
            code: 'custom',
            path: ['steps'],
            message: 'Automation IR V1 does not support control-flow cycles. Use an explicit loop construct in a future schema version instead.',
        })
    }

    automation.steps.forEach((step, index) => {
        if (!reachable.has(step.id)) {
            ctx.addIssue({
                code: 'custom',
                path: ['steps', index, 'id'],
                message: `Step "${step.id}" is unreachable from the trigger.`,
            })
        }
    })
})

export type AutomationIrV1 = z.infer<typeof AutomationIrV1Schema>
export type AutomationIr = AutomationIrV1

export function parseAutomationIr(value: unknown): AutomationIr {
    return AutomationIrV1Schema.parse(value)
}

export function safeParseAutomationIr(value: unknown): ReturnType<typeof AutomationIrV1Schema.safeParse> {
    return AutomationIrV1Schema.safeParse(value)
}

type ControlTarget = {
    value: string | undefined
    path: string[]
}

function controlTargets(step: AutomationStep): ControlTarget[] {
    switch (step.type) {
        case 'ACTION':
        case 'NOTIFICATION':
            return [{ value: step.next, path: ['next'] }]
        case 'CONDITION':
            return [
                { value: step.ifTrue, path: ['ifTrue'] },
                { value: step.ifFalse, path: ['ifFalse'] },
            ]
        case 'AI_DECISION':
            return [
                ...step.routes.map((route, index) => ({
                    value: route.next,
                    path: ['routes', String(index), 'next'],
                })),
                { value: step.fallback, path: ['fallback'] },
            ]
        case 'APPROVAL_GATE':
            return [
                { value: step.onApproved, path: ['onApproved'] },
                { value: step.onRejected, path: ['onRejected'] },
            ]
    }
}

function collectStepReferences(step: AutomationStep): Array<AutomationReference & { source: 'STEP' }> {
    const values: AutomationValue[] = []

    switch (step.type) {
        case 'ACTION':
        case 'NOTIFICATION':
        case 'AI_DECISION':
            values.push(step.input)
            break
        case 'CONDITION':
            values.push(step.expression.left)
            if (step.expression.right !== undefined) {
                values.push(step.expression.right)
            }
            break
        case 'APPROVAL_GATE':
            values.push(step.prompt)
            break
    }

    return values
        .flatMap((value) => collectReferences(value))
        .filter((reference): reference is AutomationReference & { source: 'STEP' } => reference.source === 'STEP')
}

function collectReferences(value: AutomationValue): AutomationReference[] {
    if (isReference(value)) {
        return [value]
    }
    if (Array.isArray(value)) {
        return value.flatMap((item) => collectReferences(item))
    }
    if (value !== null && typeof value === 'object') {
        return Object.values(value).flatMap((item) => collectReferences(item))
    }
    return []
}

function isReference(value: AutomationValue): value is AutomationReference {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && 'kind' in value
        && value.kind === 'REFERENCE'
}
