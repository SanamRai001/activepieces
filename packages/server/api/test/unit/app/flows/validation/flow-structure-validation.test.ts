import {
    BranchExecutionType,
    BranchOperator,
    FlowActionType,
    FlowTriggerType,
    RouterExecutionType,
    Step,
} from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import {
    hasNoBlockingFlowStructureIssues,
    validateFlowStructure,
} from '../../../../../src/app/flows/validation/flow-structure-validation'

const updatedAt = '2026-09-25T00:00:00.000Z'

function pieceAction(params: {
    name: string
    displayName?: string
    valid?: boolean
    input?: Record<string, unknown>
    nextAction?: Step
    skip?: boolean
}): Step {
    return {
        type: FlowActionType.PIECE,
        name: params.name,
        displayName: params.displayName ?? params.name,
        valid: params.valid ?? true,
        lastUpdatedDate: updatedAt,
        skip: params.skip,
        settings: {
            pieceName: '@activepieces/piece-example',
            pieceVersion: '1.0.0',
            actionName: 'run',
            input: params.input ?? {},
            propertySettings: {},
            errorHandlingOptions: {},
        },
        nextAction: params.nextAction,
    }
}

function configuredTrigger(nextAction?: Step): Step {
    return {
        type: FlowTriggerType.PIECE,
        name: 'trigger',
        displayName: 'Trigger',
        valid: true,
        lastUpdatedDate: updatedAt,
        settings: {
            pieceName: '@activepieces/piece-example',
            pieceVersion: '1.0.0',
            triggerName: 'event',
            input: {},
            propertySettings: {},
        },
        nextAction,
    }
}

function emptyTrigger(): Step {
    return {
        type: FlowTriggerType.EMPTY,
        name: 'trigger',
        displayName: 'Trigger',
        valid: false,
        lastUpdatedDate: updatedAt,
        settings: {},
    }
}

describe('validateFlowStructure', () => {
    it('accepts a configured trigger and valid action chain', () => {
        const trigger = configuredTrigger(pieceAction({ name: 'step_1' }))

        const result = validateFlowStructure({ trigger })

        expect(result).toEqual({
            totalSteps: 2,
            validSteps: 2,
            invalidSteps: 0,
            skippedSteps: 0,
            issues: [],
        })
        expect(hasNoBlockingFlowStructureIssues(result.issues)).toBe(true)
    })

    it('reports an unconfigured trigger', () => {
        const result = validateFlowStructure({ trigger: emptyTrigger() })

        expect(result.invalidSteps).toBe(1)
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'step_validity',
                severity: 'error',
                stepName: 'trigger',
            }),
        ]))
    })

    it('reports invalid actions', () => {
        const trigger = configuredTrigger(pieceAction({
            name: 'step_1',
            valid: false,
        }))

        const result = validateFlowStructure({ trigger })

        expect(result.invalidSteps).toBe(1)
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'step_validity',
                stepName: 'step_1',
                severity: 'error',
            }),
        ]))
    })

    it('reports references to missing steps', () => {
        const trigger = configuredTrigger(pieceAction({
            name: 'step_1',
            input: {
                value: "{{missing_step['output']['id']}}",
            },
        }))

        const result = validateFlowStructure({ trigger })

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'template_reference',
                stepName: 'step_1',
                message: expect.stringContaining('does not exist'),
            }),
        ]))
    })

    it('reports references to later steps', () => {
        const step2 = pieceAction({ name: 'step_2' })
        const step1 = pieceAction({
            name: 'step_1',
            input: {
                value: "{{step_2['output']['id']}}",
            },
            nextAction: step2,
        })

        const result = validateFlowStructure({
            trigger: configuredTrigger(step1),
        })

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'template_reference',
                stepName: 'step_1',
                message: expect.stringContaining('comes after it'),
            }),
        ]))
    })

    it('ignores connection expressions when checking step references', () => {
        const trigger = configuredTrigger(pieceAction({
            name: 'step_1',
            input: {
                auth: "{{connections['github-main']}}",
            },
        }))

        const result = validateFlowStructure({ trigger })

        expect(result.issues).toEqual([])
    })

    it('reports an empty condition branch as blocking and an empty fallback as informational', () => {
        const router: Step = {
            type: FlowActionType.ROUTER,
            name: 'router_1',
            displayName: 'Check value',
            valid: true,
            lastUpdatedDate: updatedAt,
            settings: {
                executionType: RouterExecutionType.EXECUTE_FIRST_MATCH,
                branches: [
                    {
                        branchName: 'Matches',
                        branchType: BranchExecutionType.CONDITION,
                        conditions: [[{
                            firstValue: "{{trigger['output']['value']}}",
                            secondValue: 'yes',
                            operator: BranchOperator.TEXT_EXACTLY_MATCHES,
                        }]],
                    },
                    {
                        branchName: 'Otherwise',
                        branchType: BranchExecutionType.FALLBACK,
                    },
                ],
            },
            children: [null, null],
        }

        const result = validateFlowStructure({
            trigger: configuredTrigger(router),
        })

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'empty_branch',
                severity: 'warning',
                message: expect.stringContaining('Matches'),
            }),
            expect.objectContaining({
                category: 'empty_branch',
                severity: 'info',
                message: expect.stringContaining('Otherwise'),
            }),
        ]))
        expect(hasNoBlockingFlowStructureIssues(result.issues)).toBe(false)
    })

    it('counts skipped actions separately from invalid actions', () => {
        const trigger = configuredTrigger(pieceAction({
            name: 'step_1',
            valid: false,
            skip: true,
        }))

        const result = validateFlowStructure({ trigger })

        expect(result.skippedSteps).toBe(1)
        expect(result.invalidSteps).toBe(0)
    })
})
