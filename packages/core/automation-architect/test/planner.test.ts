import { describe, expect, it } from 'vitest'
import {
    AutomationPlannerInput,
    AutomationPlannerModel,
    NaturalLanguageAutomationPlanner,
} from '../src'

const capabilities: AutomationPlannerInput['capabilities'] = [
    {
        id: 'github.issue.created',
        kind: 'TRIGGER',
        name: 'GitHub issue created',
        description: 'Starts when a GitHub issue is created.',
        connection: {
            required: true,
            available: true,
            label: 'GitHub',
        },
    },
    {
        id: 'github.issue.label',
        kind: 'ACTION',
        name: 'Label GitHub issue',
        description: 'Adds a label to a GitHub issue.',
        connection: {
            required: true,
            available: true,
            label: 'GitHub',
        },
        risk: {
            class: 'REVERSIBLE_WRITE',
            rationale: 'Adding a label is a reversible repository mutation.',
        },
    },
    {
        id: 'email.send',
        kind: 'NOTIFICATION',
        name: 'Send email',
        description: 'Sends an email.',
        connection: {
            required: true,
            available: true,
            label: 'Email',
        },
        risk: {
            class: 'EXTERNAL_COMMUNICATION',
            rationale: 'This sends content outside the system.',
        },
    },
]

const baseInput: AutomationPlannerInput = {
    goal: 'When a GitHub issue is created, label it and email me.',
    capabilities,
    policy: {
        requireApprovalFor: ['EXTERNAL_COMMUNICATION'],
        deny: [],
        maxAttemptsPerStep: 3,
    },
    constraints: [],
}

const validAutomation = {
    schemaVersion: '1',
    name: 'GitHub issue triage',
    goal: baseInput.goal,
    trigger: {
        type: 'EVENT',
        capability: 'github.issue.created',
        next: 'label_issue',
    },
    steps: [
        {
            id: 'label_issue',
            name: 'Label issue',
            type: 'ACTION',
            capability: 'github.issue.label',
            input: {
                issueId: {
                    kind: 'REFERENCE',
                    source: 'TRIGGER',
                    path: ['id'],
                },
            },
            next: 'notify',
        },
        {
            id: 'notify',
            name: 'Notify owner',
            type: 'NOTIFICATION',
            capability: 'email.send',
            input: {
                subject: 'New GitHub issue',
            },
            risk: {
                class: 'READ_ONLY',
                rationale: 'The model incorrectly under-classified this step.',
            },
        },
    ],
} as const

class StaticPlannerModel implements AutomationPlannerModel {
    constructor(private readonly response: unknown) {}

    async generatePlan(): Promise<unknown> {
        return this.response
    }
}

describe('NaturalLanguageAutomationPlanner', () => {
    it('returns grounded Automation IR for a valid model plan', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            automation: validAutomation,
            explanation: 'Label the incoming issue, then send an email.',
            assumptions: ['The email connection belongs to the project owner.'],
        }))

        const result = await planner.plan(baseInput)

        expect(result.status).toBe('READY')
        if (result.status !== 'READY') {
            throw new Error('Expected planner to be ready.')
        }

        expect(result.automation.trigger.type).toBe('EVENT')
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'POLICY_APPROVAL_REQUIRED',
                capabilityId: 'email.send',
            }),
        ]))

        const notification = result.automation.steps.find((step) => step.id === 'notify')
        expect(notification?.risk?.class).toBe('EXTERNAL_COMMUNICATION')
    })

    it('keeps the user goal authoritative when the model rewrites it', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            automation: {
                ...validAutomation,
                goal: 'A different objective invented by the model.',
            },
            explanation: 'Use the grounded plan.',
        }))

        const result = await planner.plan(baseInput)

        expect(result.status).toBe('READY')
        if (result.status !== 'READY') {
            throw new Error('Expected planner to be ready.')
        }
        expect(result.automation.goal).toBe(baseInput.goal)
    })

    it('passes centralized safety rules to the model adapter', async () => {
        let capturedRules: string[] = []
        const model: AutomationPlannerModel = {
            async generatePlan(input): Promise<unknown> {
                capturedRules = input.rules
                return {
                    status: 'READY',
                    automation: validAutomation,
                    explanation: 'Use the supplied capabilities only.',
                }
            },
        }

        const planner = new NaturalLanguageAutomationPlanner(model)
        const result = await planner.plan(baseInput)

        expect(result.status).toBe('READY')
        expect(capturedRules).toEqual(expect.arrayContaining([
            expect.stringContaining('Use only capability ids supplied'),
            expect.stringContaining('Prefer deterministic conditions'),
            expect.stringContaining('never execute, publish, activate'),
        ]))
    })

    it('returns model questions when the request is materially ambiguous', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'NEEDS_INPUT',
            explanation: 'The destination is not specified.',
            questions: [{
                id: 'destination',
                question: 'Where should the summary be sent?',
                reason: 'The requested action depends on the destination.',
            }],
        }))

        const result = await planner.plan(baseInput)

        expect(result.status).toBe('NEEDS_INPUT')
        if (result.status !== 'NEEDS_INPUT') {
            throw new Error('Expected planner to need input.')
        }
        expect(result.questions[0]?.id).toBe('destination')
        expect(result.diagnostics).toEqual([])
    })

    it('rejects capabilities invented by the model', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            explanation: 'Use an unavailable action.',
            automation: {
                ...validAutomation,
                steps: [
                    {
                        ...validAutomation.steps[0],
                        capability: 'github.issue.delete_everything',
                    },
                    validAutomation.steps[1],
                ],
            },
        }))

        const result = await planner.plan(baseInput)

        expect(result.status).toBe('FAILED')
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'UNKNOWN_CAPABILITY',
                capabilityId: 'github.issue.delete_everything',
            }),
        ]))
    })

    it('rejects capability kind mismatches', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            explanation: 'Use the wrong capability kind.',
            automation: {
                ...validAutomation,
                steps: [
                    {
                        ...validAutomation.steps[0],
                        capability: 'email.send',
                    },
                    validAutomation.steps[1],
                ],
            },
        }))

        const result = await planner.plan(baseInput)

        expect(result.status).toBe('FAILED')
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'CAPABILITY_KIND_MISMATCH',
                capabilityId: 'email.send',
            }),
        ]))
    })

    it('returns connection guidance when a required connection is unavailable', async () => {
        const input: AutomationPlannerInput = {
            ...baseInput,
            capabilities: baseInput.capabilities.map((capability) =>
                capability.id === 'email.send'
                    ? {
                        ...capability,
                        connection: {
                            required: true,
                            available: false,
                            label: 'Email',
                        },
                    }
                    : capability,
            ),
        }

        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            automation: validAutomation,
            explanation: 'The plan needs email.',
        }))

        const result = await planner.plan(input)

        expect(result.status).toBe('NEEDS_INPUT')
        if (result.status !== 'NEEDS_INPUT') {
            throw new Error('Expected missing connection to require input.')
        }

        expect(result.questions).toEqual([
            expect.objectContaining({
                id: 'connect:email.send',
            }),
        ])
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'CONNECTION_REQUIRED',
                capabilityId: 'email.send',
            }),
        ]))
    })

    it('fails when deterministic policy denies the required operation', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            automation: validAutomation,
            explanation: 'The plan contains email.',
        }))

        const result = await planner.plan({
            ...baseInput,
            policy: {
                requireApprovalFor: [],
                deny: ['EXTERNAL_COMMUNICATION'],
                maxAttemptsPerStep: 3,
            },
        })

        expect(result.status).toBe('FAILED')
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'POLICY_DENIED',
                capabilityId: 'email.send',
            }),
        ]))
    })

    it('uses authoritative capability risk instead of trusting model risk', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            automation: validAutomation,
            explanation: 'The model claims email is read-only.',
        }))

        const result = await planner.plan(baseInput)

        expect(result.status).toBe('READY')
        if (result.status !== 'READY') {
            throw new Error('Expected planner to be ready.')
        }

        const notification = result.automation.steps.find((step) => step.id === 'notify')
        expect(notification?.risk).toEqual({
            class: 'EXTERNAL_COMMUNICATION',
            rationale: 'This sends content outside the system.',
        })
    })

    it('rejects invalid Automation IR returned by the model', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            explanation: 'This plan is structurally broken.',
            automation: {
                ...validAutomation,
                trigger: {
                    type: 'EVENT',
                    capability: 'github.issue.created',
                    next: 'missing',
                },
            },
        }))

        const result = await planner.plan(baseInput)

        expect(result.status).toBe('FAILED')
        expect(result.diagnostics[0]?.code).toBe('INVALID_AUTOMATION_IR')
    })

    it('rejects duplicate capabilities in planner input before calling the model', async () => {
        let called = false
        const model: AutomationPlannerModel = {
            async generatePlan(): Promise<unknown> {
                called = true
                return {
                    status: 'READY',
                    automation: validAutomation,
                    explanation: 'Should not be reached.',
                }
            },
        }

        const planner = new NaturalLanguageAutomationPlanner(model)
        const result = await planner.plan({
            ...baseInput,
            capabilities: [
                ...baseInput.capabilities,
                baseInput.capabilities[0],
            ],
        })

        expect(result.status).toBe('FAILED')
        expect(result.diagnostics[0]?.code).toBe('INVALID_INPUT')
        expect(called).toBe(false)
    })

    it('returns a stable diagnostic when the model throws', async () => {
        const model: AutomationPlannerModel = {
            async generatePlan(): Promise<unknown> {
                throw new Error('provider unavailable')
            },
        }

        const planner = new NaturalLanguageAutomationPlanner(model)
        const result = await planner.plan(baseInput)

        expect(result.status).toBe('FAILED')
        expect(result.diagnostics[0]).toEqual(expect.objectContaining({
            code: 'MODEL_FAILURE',
            message: expect.stringContaining('provider unavailable'),
        }))
    })

    it('rejects malformed planner-model envelopes', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            automation: validAutomation,
        }))

        const result = await planner.plan(baseInput)

        expect(result.status).toBe('FAILED')
        expect(result.diagnostics[0]?.code).toBe('MODEL_OUTPUT_INVALID')
    })

    it('does not require integration capabilities for a manual deterministic plan', async () => {
        const planner = new NaturalLanguageAutomationPlanner(new StaticPlannerModel({
            status: 'READY',
            explanation: 'Compare two fixed values.',
            automation: {
                schemaVersion: '1',
                name: 'Manual comparison',
                goal: 'Compare two values.',
                trigger: {
                    type: 'MANUAL',
                    next: 'compare',
                },
                steps: [{
                    id: 'compare',
                    name: 'Compare',
                    type: 'CONDITION',
                    expression: {
                        left: 10,
                        operator: 'GREATER_THAN',
                        right: 5,
                    },
                }],
            },
        }))

        const result = await planner.plan({
            ...baseInput,
            capabilities: [],
        })

        expect(result.status).toBe('READY')
    })

    it('rejects action capabilities without authoritative risk metadata', async () => {
        let called = false
        const model: AutomationPlannerModel = {
            async generatePlan(): Promise<unknown> {
                called = true
                return {
                    status: 'READY',
                    automation: validAutomation,
                    explanation: 'Should not be reached.',
                }
            },
        }

        const planner = new NaturalLanguageAutomationPlanner(model)
        const result = await planner.plan({
            ...baseInput,
            capabilities: [{
                id: 'unsafe.unknown',
                kind: 'ACTION',
                name: 'Unknown action',
                description: 'An action without classified risk.',
                connection: {
                    required: false,
                    available: true,
                },
            }],
        })

        expect(result.status).toBe('FAILED')
        expect(result.diagnostics[0]?.code).toBe('INVALID_INPUT')
        expect(called).toBe(false)
    })
})
