import { describe, expect, it } from 'vitest'
import {
    AutomationIrV1Schema,
    AutomationPolicySchema,
    parseAutomationIr,
} from '../src'

const basicAutomation = {
    schemaVersion: '1',
    name: 'Send a project update',
    goal: 'Send an update after a manual trigger.',
    trigger: {
        type: 'MANUAL',
        next: 'send_update',
    },
    steps: [
        {
            id: 'send_update',
            name: 'Send update',
            type: 'ACTION',
            capability: 'email.send',
            input: {
                to: 'owner@example.com',
                subject: 'Project update',
            },
            risk: {
                class: 'EXTERNAL_COMMUNICATION',
                rationale: 'This sends a message outside the system.',
            },
        },
    ],
} as const

describe('Automation IR V1', () => {
    it('parses a minimal valid automation', () => {
        const automation = parseAutomationIr(basicAutomation)

        expect(automation.schemaVersion).toBe('1')
        expect(automation.trigger.type).toBe('MANUAL')
        expect(automation.steps).toHaveLength(1)
    })

    it('supports event inputs and references to trigger and earlier step outputs', () => {
        const result = AutomationIrV1Schema.safeParse({
            schemaVersion: '1',
            name: 'Triage incoming issue',
            goal: 'Classify an incoming issue and notify the right place.',
            trigger: {
                type: 'EVENT',
                capability: 'issues.created',
                input: {},
                next: 'classify',
            },
            steps: [
                {
                    id: 'classify',
                    name: 'Classify issue',
                    type: 'AI_DECISION',
                    instruction: 'Classify the issue as bug or question.',
                    input: {
                        title: {
                            kind: 'REFERENCE',
                            source: 'TRIGGER',
                            path: ['title'],
                        },
                    },
                    routes: [
                        {
                            key: 'bug',
                            description: 'The issue reports a defect.',
                            next: 'notify',
                        },
                        {
                            key: 'question',
                            description: 'The issue is a question.',
                            next: 'notify',
                        },
                    ],
                },
                {
                    id: 'notify',
                    name: 'Notify',
                    type: 'NOTIFICATION',
                    capability: 'notification.send',
                    input: {
                        classification: {
                            kind: 'REFERENCE',
                            source: 'STEP',
                            stepId: 'classify',
                            path: ['route'],
                        },
                    },
                },
            ],
        })

        expect(result.success).toBe(true)
    })

    it('supports deterministic conditions and approval gates', () => {
        const result = AutomationIrV1Schema.safeParse({
            schemaVersion: '1',
            name: 'Large invoice approval',
            goal: 'Require approval before processing a large invoice.',
            trigger: {
                type: 'EVENT',
                capability: 'invoice.received',
                next: 'is_large',
            },
            steps: [
                {
                    id: 'is_large',
                    name: 'Check amount',
                    type: 'CONDITION',
                    expression: {
                        left: {
                            kind: 'REFERENCE',
                            source: 'TRIGGER',
                            path: ['amount'],
                        },
                        operator: 'GREATER_THAN',
                        right: 10000,
                    },
                    ifTrue: 'approval',
                    ifFalse: 'record',
                },
                {
                    id: 'approval',
                    name: 'Approve large invoice',
                    type: 'APPROVAL_GATE',
                    prompt: 'Approve processing this large invoice?',
                    onApproved: 'record',
                },
                {
                    id: 'record',
                    name: 'Record invoice',
                    type: 'ACTION',
                    capability: 'accounting.invoice.record',
                    input: {},
                },
            ],
        })

        expect(result.success).toBe(true)
    })

    it('rejects duplicate step ids', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            steps: [
                basicAutomation.steps[0],
                {
                    ...basicAutomation.steps[0],
                    name: 'Duplicate',
                },
            ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('Duplicate step id'))).toBe(true)
    })

    it('rejects control-flow targets that do not exist', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            trigger: {
                type: 'MANUAL',
                next: 'missing_step',
            },
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('Unknown target step'))).toBe(true)
    })

    it('rejects unreachable steps', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            steps: [
                basicAutomation.steps[0],
                {
                    id: 'orphan',
                    name: 'Orphan step',
                    type: 'ACTION',
                    capability: 'noop.execute',
                    input: {},
                },
            ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('unreachable'))).toBe(true)
    })

    it('rejects control-flow cycles because V1 has no loop construct', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            steps: [
                {
                    ...basicAutomation.steps[0],
                    next: 'second',
                },
                {
                    id: 'second',
                    name: 'Second step',
                    type: 'ACTION',
                    capability: 'noop.execute',
                    input: {},
                    next: 'send_update',
                },
            ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('does not support control-flow cycles'))).toBe(true)
    })

    it('rejects references to unknown step output', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            steps: [
                {
                    ...basicAutomation.steps[0],
                    input: {
                        value: {
                            kind: 'REFERENCE',
                            source: 'STEP',
                            stepId: 'unknown',
                            path: ['value'],
                        },
                    },
                },
            ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('references unknown step'))).toBe(true)
    })

    it('rejects runtime references in trigger configuration', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            trigger: {
                type: 'EVENT',
                capability: 'event.received',
                input: {
                    impossible: {
                        kind: 'REFERENCE',
                        source: 'TRIGGER',
                        path: ['result'],
                    },
                },
                next: 'send_update',
            },
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('Trigger configuration cannot reference runtime outputs'))).toBe(true)
    })

    it('rejects malformed reference-shaped objects instead of treating them as plain data', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            steps: [
                {
                    ...basicAutomation.steps[0],
                    input: {
                        malformed: {
                            kind: 'REFERENCE',
                            source: 'STEP',
                            path: ['value'],
                        },
                    },
                },
            ],
        })

        expect(result.success).toBe(false)
    })

    it('rejects a step that references its own output', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            steps: [
                {
                    ...basicAutomation.steps[0],
                    input: {
                        value: {
                            kind: 'REFERENCE',
                            source: 'STEP',
                            stepId: 'send_update',
                            path: ['result'],
                        },
                    },
                },
            ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('cannot reference its own output'))).toBe(true)
    })

    it('requires a right-hand value for binary conditions', () => {
        const result = AutomationIrV1Schema.safeParse({
            schemaVersion: '1',
            name: 'Broken condition',
            goal: 'Demonstrate condition validation.',
            trigger: {
                type: 'MANUAL',
                next: 'check',
            },
            steps: [
                {
                    id: 'check',
                    name: 'Check',
                    type: 'CONDITION',
                    expression: {
                        left: 10,
                        operator: 'GREATER_THAN',
                    },
                },
            ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('requires a right-hand value'))).toBe(true)
    })

    it('rejects a right-hand value for unary conditions', () => {
        const result = AutomationIrV1Schema.safeParse({
            schemaVersion: '1',
            name: 'Broken unary condition',
            goal: 'Demonstrate unary condition validation.',
            trigger: {
                type: 'MANUAL',
                next: 'check',
            },
            steps: [
                {
                    id: 'check',
                    name: 'Check',
                    type: 'CONDITION',
                    expression: {
                        left: true,
                        operator: 'IS_TRUE',
                        right: true,
                    },
                },
            ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('does not accept a right-hand value'))).toBe(true)
    })

    it('rejects duplicate AI route keys case-insensitively', () => {
        const result = AutomationIrV1Schema.safeParse({
            schemaVersion: '1',
            name: 'Broken AI decision',
            goal: 'Demonstrate route validation.',
            trigger: {
                type: 'MANUAL',
                next: 'decide',
            },
            steps: [
                {
                    id: 'decide',
                    name: 'Decide',
                    type: 'AI_DECISION',
                    instruction: 'Choose a route.',
                    input: {},
                    routes: [
                        { key: 'Continue', description: 'Continue.' },
                        { key: 'continue', description: 'Also continue.' },
                    ],
                },
            ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.issues.some((issue) => issue.message.includes('Duplicate AI decision route key'))).toBe(true)
    })

    it('rejects unknown IR versions instead of silently accepting them', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            schemaVersion: '2',
        })

        expect(result.success).toBe(false)
    })

    it('rejects unknown fields so planner/compiler drift is visible', () => {
        const result = AutomationIrV1Schema.safeParse({
            ...basicAutomation,
            unexpectedField: 'should not be ignored',
        })

        expect(result.success).toBe(false)
    })
})

describe('Automation policy contract', () => {
    it('keeps authorization policy separate from planner output', () => {
        const policy = AutomationPolicySchema.parse({
            requireApprovalFor: [
                'EXTERNAL_COMMUNICATION',
                'SENSITIVE_MUTATION',
                'DESTRUCTIVE',
                'FINANCIAL',
            ],
        })

        expect(policy.maxAttemptsPerStep).toBe(3)
        expect(policy.deny).toEqual([])
        expect(policy.requireApprovalFor).toContain('DESTRUCTIVE')
    })

    it('rejects contradictory deny and approval rules', () => {
        const result = AutomationPolicySchema.safeParse({
            requireApprovalFor: ['DESTRUCTIVE'],
            deny: ['DESTRUCTIVE'],
        })

        expect(result.success).toBe(false)
    })
})
