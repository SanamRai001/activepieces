import {
    FlowActionType,
    FlowStatus,
    FlowTriggerType,
    FlowVersionState,
    Step,
} from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import {
    AutomationDraftValidationDependencies,
    createAutomationDraftValidationService,
} from '../../../src/app/automation-architect/draft-validation.service'

const updatedAt = '2026-09-25T00:00:00.000Z'

function action(valid = true): Step {
    return {
        type: FlowActionType.PIECE,
        name: 'step_1',
        displayName: 'Step 1',
        valid,
        lastUpdatedDate: updatedAt,
        settings: {
            pieceName: '@activepieces/piece-example',
            pieceVersion: '1.0.0',
            actionName: 'run',
            input: {},
            propertySettings: {},
            errorHandlingOptions: {},
        },
    }
}

function trigger(nextAction?: Step): Step {
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

function dependencies(overrides: Partial<AutomationDraftValidationDependencies> = {}): AutomationDraftValidationDependencies {
    return {
        getFlow: async () => ({
            id: 'flow-1',
            status: FlowStatus.DISABLED,
            publishedVersionId: null,
            version: {
                state: FlowVersionState.DRAFT,
                trigger: trigger(action()),
            },
        }),
        ...overrides,
    }
}

describe('Automation draft validation service', () => {
    it('returns VALIDATED_DRAFT for a safe structurally valid draft', async () => {
        const service = createAutomationDraftValidationService(dependencies())

        const result = await service.validate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('VALIDATED_DRAFT')
        expect(result.structural?.issues).toEqual([])
    })

    it('returns NEEDS_CONFIGURATION when structural validation has blocking issues', async () => {
        const service = createAutomationDraftValidationService(dependencies({
            getFlow: async () => ({
                id: 'flow-1',
                status: FlowStatus.DISABLED,
                publishedVersionId: null,
                version: {
                    state: FlowVersionState.DRAFT,
                    trigger: trigger(action(false)),
                },
            }),
        }))

        const result = await service.validate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('NEEDS_CONFIGURATION')
        expect(result.structural?.invalidSteps).toBe(1)
    })

    it('returns FLOW_NOT_FOUND when the flow does not exist in project scope', async () => {
        const service = createAutomationDraftValidationService(dependencies({
            getFlow: async () => null,
        }))

        const result = await service.validate({
            flowId: 'missing',
            projectId: 'project-1',
        })

        expect(result).toEqual({
            status: 'FLOW_NOT_FOUND',
            flowId: 'missing',
        })
    })

    it.each([
        {
            name: 'enabled flow',
            status: FlowStatus.ENABLED,
            publishedVersionId: null,
            versionState: FlowVersionState.DRAFT,
        },
        {
            name: 'published flow',
            status: FlowStatus.DISABLED,
            publishedVersionId: 'published-version',
            versionState: FlowVersionState.DRAFT,
        },
        {
            name: 'locked version',
            status: FlowStatus.DISABLED,
            publishedVersionId: null,
            versionState: FlowVersionState.LOCKED,
        },
    ])('returns UNSAFE_ARTIFACT for $name', async ({ status, publishedVersionId, versionState }) => {
        const service = createAutomationDraftValidationService(dependencies({
            getFlow: async () => ({
                id: 'flow-1',
                status,
                publishedVersionId,
                version: {
                    state: versionState,
                    trigger: trigger(action()),
                },
            }),
        }))

        const result = await service.validate({
            flowId: 'flow-1',
            projectId: 'project-1',
        })

        expect(result.status).toBe('UNSAFE_ARTIFACT')
        expect(result.reasons?.length).toBeGreaterThan(0)
    })
})
