import { FlowActionType, FlowOperationType, FlowStatus, FlowTriggerType } from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import {
    type ActivepiecesIrCompilerDependencies,
    type CompilerPieceMetadata,
    createActivepiecesIrCompiler,
    parseActivepiecesCapabilityId,
} from '../../../src/app/automation-architect/ir-compiler'
import {
    type ActivepiecesDraftCompilerDependencies,
    createActivepiecesDraftCompiler,
} from '../../../src/app/automation-architect/ir-compiler.service'

const PROJECT_ID = 'project-1'
const PLATFORM_ID = 'platform-1'
const NOW = '2026-09-24T16:00:00.000Z'

function githubPiece(): CompilerPieceMetadata {
    return {
        name: '@activepieces/piece-github',
        displayName: 'GitHub',
        version: '1.2.3',
        actions: {
            add_label: {
                name: 'add_label',
                displayName: 'Add Label',
                requireAuth: true,
                props: {
                    issueId: { required: true },
                    label: { required: true },
                },
            },
            send_comment: {
                name: 'send_comment',
                displayName: 'Send Comment',
                requireAuth: true,
                props: {
                    issueId: { required: true },
                    body: { required: true },
                },
            },
        },
        triggers: {
            new_issue: {
                name: 'new_issue',
                displayName: 'New Issue',
                requireAuth: true,
                props: {
                    repository: { required: true },
                },
            },
        },
    }
}

function schedulePiece(): CompilerPieceMetadata {
    return {
        name: '@activepieces/piece-schedule',
        displayName: 'Schedule',
        version: '0.1.22',
        actions: {},
        triggers: {
            cron_expression: {
                name: 'cron_expression',
                displayName: 'Cron Expression',
                requireAuth: false,
                props: {
                    cronExpression: { required: true },
                    timezone: { required: true },
                },
            },
        },
    }
}

function dependencies(
    pieces: Record<string, CompilerPieceMetadata> = {
        '@activepieces/piece-github': githubPiece(),
        '@activepieces/piece-schedule': schedulePiece(),
    },
): ActivepiecesIrCompilerDependencies {
    return {
        getPiece: async ({ name }) => pieces[name],
        now: () => NOW,
    }
}

function baseEventAutomation() {
    return {
        schemaVersion: '1',
        name: 'Issue triage',
        goal: 'Label new issues.',
        trigger: {
            type: 'EVENT',
            capability: 'activepieces:trigger:@activepieces/piece-github:new_issue',
            input: {
                repository: 'acme/api',
            },
            next: 'label',
        },
        steps: [{
            id: 'label',
            name: 'Label issue',
            type: 'ACTION',
            capability: 'activepieces:action:@activepieces/piece-github:add_label',
            input: {
                issueId: {
                    kind: 'REFERENCE',
                    source: 'TRIGGER',
                    path: ['id'],
                },
                label: 'needs-review',
            },
        }],
    } as const
}

describe('Activepieces IR compiler', () => {
    it('strictly parses planner-facing capability ids', () => {
        expect(parseActivepiecesCapabilityId('activepieces:action:@activepieces/piece-github:add_label')).toEqual({
            kind: 'action',
            pieceName: '@activepieces/piece-github',
            componentName: 'add_label',
        })
        expect(parseActivepiecesCapabilityId('github:add_label')).toBeUndefined()
        expect(parseActivepiecesCapabilityId('activepieces:action:piece:with:colon')).toBeUndefined()
    })

    it('compiles an event trigger and action using exact project-visible piece versions', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: baseEventAutomation(),
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            connectionBindings: {
                'activepieces:trigger:@activepieces/piece-github:new_issue': 'github-main',
                'activepieces:action:@activepieces/piece-github:add_label': 'github-main',
            },
        })

        expect(result.status).toBe('COMPILED')
        if (result.status !== 'COMPILED') {
            throw new Error('Expected compiled result.')
        }

        expect(result.operations).toHaveLength(2)
        expect(result.operations.map((operation) => operation.type)).toEqual([
            FlowOperationType.UPDATE_TRIGGER,
            FlowOperationType.ADD_ACTION,
        ])
        expect(result.operations).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ type: FlowOperationType.IMPORT_FLOW }),
        ]))

        const triggerOperation = result.operations[0]
        if (triggerOperation?.type !== FlowOperationType.UPDATE_TRIGGER) {
            throw new Error('Expected UPDATE_TRIGGER.')
        }
        expect(triggerOperation.request.type).toBe(FlowTriggerType.PIECE)
        if (triggerOperation.request.type !== FlowTriggerType.PIECE) {
            throw new Error('Expected piece trigger.')
        }
        expect(triggerOperation.request.settings).toEqual(expect.objectContaining({
            pieceName: '@activepieces/piece-github',
            pieceVersion: '1.2.3',
            triggerName: 'new_issue',
            input: {
                repository: 'acme/api',
                auth: '{{connections[\'github-main\']}}',
            },
        }))

        const actionOperation = result.operations[1]
        if (actionOperation?.type !== FlowOperationType.ADD_ACTION) {
            throw new Error('Expected ADD_ACTION.')
        }
        expect(actionOperation.request.action.type).toBe(FlowActionType.PIECE)
        if (actionOperation.request.action.type !== FlowActionType.PIECE) {
            throw new Error('Expected piece action.')
        }
        expect(actionOperation.request.action.settings.pieceVersion).toBe('1.2.3')
        expect(actionOperation.request.action.settings.input.issueId).toBe('{{trigger[\'output\'][\'id\']}}')
    })

    it('compiles cron schedules through the built-in schedule piece', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: {
                schemaVersion: '1',
                name: 'Nightly report',
                goal: 'Run nightly.',
                trigger: {
                    type: 'SCHEDULE',
                    cron: '0 22 * * *',
                    timezone: 'Asia/Kathmandu',
                    next: 'comment',
                },
                steps: [{
                    id: 'comment',
                    name: 'Send comment',
                    type: 'ACTION',
                    capability: 'activepieces:action:@activepieces/piece-github:send_comment',
                    input: {
                        issueId: '123',
                        body: 'Nightly complete',
                    },
                }],
            },
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            connectionBindings: {
                'activepieces:action:@activepieces/piece-github:send_comment': 'github-main',
            },
        })

        expect(result.status).toBe('COMPILED')
        if (result.status !== 'COMPILED') throw new Error('Expected compiled result.')
        const operation = result.operations[0]
        if (operation?.type !== FlowOperationType.UPDATE_TRIGGER) throw new Error('Expected trigger update.')
        if (operation.request.type !== FlowTriggerType.PIECE) throw new Error('Expected piece trigger.')
        expect(operation.request.settings).toEqual(expect.objectContaining({
            pieceName: '@activepieces/piece-schedule',
            pieceVersion: '0.1.22',
            triggerName: 'cron_expression',
            input: {
                cronExpression: '0 22 * * *',
                timezone: 'Asia/Kathmandu',
            },
        }))
    })

    it('compiles tree-shaped deterministic conditions into an Activepieces router', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: {
                schemaVersion: '1',
                name: 'Conditional triage',
                goal: 'Branch on priority.',
                trigger: {
                    type: 'EVENT',
                    capability: 'activepieces:trigger:@activepieces/piece-github:new_issue',
                    input: { repository: 'acme/api' },
                    next: 'priority',
                },
                steps: [
                    {
                        id: 'priority',
                        name: 'Is urgent',
                        type: 'CONDITION',
                        expression: {
                            left: {
                                kind: 'REFERENCE',
                                source: 'TRIGGER',
                                path: ['priority'],
                            },
                            operator: 'EQUALS',
                            right: 'urgent',
                        },
                        ifTrue: 'label',
                        ifFalse: 'comment',
                    },
                    {
                        id: 'label',
                        name: 'Label urgent',
                        type: 'ACTION',
                        capability: 'activepieces:action:@activepieces/piece-github:add_label',
                        input: {
                            issueId: '1',
                            label: 'urgent',
                        },
                    },
                    {
                        id: 'comment',
                        name: 'Comment normal',
                        type: 'ACTION',
                        capability: 'activepieces:action:@activepieces/piece-github:send_comment',
                        input: {
                            issueId: '1',
                            body: 'Normal priority',
                        },
                    },
                ],
            },
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            connectionBindings: {
                'activepieces:trigger:@activepieces/piece-github:new_issue': 'github-main',
                'activepieces:action:@activepieces/piece-github:add_label': 'github-main',
                'activepieces:action:@activepieces/piece-github:send_comment': 'github-main',
            },
        })

        expect(result.status).toBe('COMPILED')
        if (result.status !== 'COMPILED') throw new Error('Expected compiled result.')
        const routerOperation = result.operations.find((operation) =>
            operation.type === FlowOperationType.ADD_ACTION
            && operation.request.action.type === FlowActionType.ROUTER,
        )
        expect(routerOperation?.type).toBe(FlowOperationType.ADD_ACTION)
        if (routerOperation?.type !== FlowOperationType.ADD_ACTION) throw new Error('Expected router action.')
        const router = routerOperation.request.action
        if (router.type !== FlowActionType.ROUTER) throw new Error('Expected router.')
        expect(router.settings.branches).toHaveLength(2)
        expect(router.settings.branches[0]).toEqual(expect.objectContaining({
            branchType: 'CONDITION',
            branchName: 'True',
        }))
        const branchOperations = result.operations.filter((operation) =>
            operation.type === FlowOperationType.ADD_ACTION
            && operation.request.stepLocationRelativeToParent === 'INSIDE_BRANCH',
        )
        expect(branchOperations).toEqual([
            expect.objectContaining({
                request: expect.objectContaining({
                    parentStep: 'aa_step_001',
                    branchIndex: 0,
                    action: expect.objectContaining({
                        name: 'aa_step_002',
                    }),
                }),
            }),
            expect.objectContaining({
                request: expect.objectContaining({
                    parentStep: 'aa_step_001',
                    branchIndex: 1,
                    action: expect.objectContaining({
                        name: 'aa_step_003',
                    }),
                }),
            }),
        ])
    })

    it('rejects branch joins/shared downstream steps before creating an artifact', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: {
                schemaVersion: '1',
                name: 'Join',
                goal: 'Join branches.',
                trigger: {
                    type: 'EVENT',
                    capability: 'activepieces:trigger:@activepieces/piece-github:new_issue',
                    input: { repository: 'acme/api' },
                    next: 'condition',
                },
                steps: [
                    {
                        id: 'condition',
                        name: 'Condition',
                        type: 'CONDITION',
                        expression: { left: true, operator: 'IS_TRUE' },
                        ifTrue: 'a',
                        ifFalse: 'b',
                    },
                    {
                        id: 'a',
                        name: 'A',
                        type: 'ACTION',
                        capability: 'activepieces:action:@activepieces/piece-github:add_label',
                        input: { issueId: '1', label: 'a' },
                        next: 'join',
                    },
                    {
                        id: 'b',
                        name: 'B',
                        type: 'ACTION',
                        capability: 'activepieces:action:@activepieces/piece-github:add_label',
                        input: { issueId: '1', label: 'b' },
                        next: 'join',
                    },
                    {
                        id: 'join',
                        name: 'Join',
                        type: 'ACTION',
                        capability: 'activepieces:action:@activepieces/piece-github:send_comment',
                        input: { issueId: '1', body: 'done' },
                    },
                ],
            },
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'FAILED',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'UNSUPPORTED_SHARED_STEP',
                    stepId: 'join',
                }),
            ]),
        }))
    })

    it('fails cleanly when required connection binding is missing', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: baseEventAutomation(),
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            connectionBindings: {},
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'FAILED',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'MISSING_CONNECTION_BINDING',
                }),
            ]),
        }))
    })

    it('rewrites condition references to deterministic Activepieces step names', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: {
                schemaVersion: '1',
                name: 'Referenced condition',
                goal: 'Branch on a prior step output.',
                trigger: {
                    type: 'EVENT',
                    capability: 'activepieces:trigger:@activepieces/piece-github:new_issue',
                    input: { repository: 'acme/api' },
                    next: 'label',
                },
                steps: [
                    {
                        id: 'label',
                        name: 'Label issue',
                        type: 'ACTION',
                        capability: 'activepieces:action:@activepieces/piece-github:add_label',
                        input: { issueId: '1', label: 'urgent' },
                        next: 'check',
                    },
                    {
                        id: 'check',
                        name: 'Check result',
                        type: 'CONDITION',
                        expression: {
                            left: {
                                kind: 'REFERENCE',
                                source: 'STEP',
                                stepId: 'label',
                                path: ['ok'],
                            },
                            operator: 'IS_TRUE',
                        },
                        ifTrue: 'comment',
                    },
                    {
                        id: 'comment',
                        name: 'Comment',
                        type: 'ACTION',
                        capability: 'activepieces:action:@activepieces/piece-github:send_comment',
                        input: { issueId: '1', body: 'done' },
                    },
                ],
            },
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            connectionBindings: {
                'activepieces:trigger:@activepieces/piece-github:new_issue': 'github-main',
                'activepieces:action:@activepieces/piece-github:add_label': 'github-main',
                'activepieces:action:@activepieces/piece-github:send_comment': 'github-main',
            },
        })

        expect(result.status).toBe('COMPILED')
        if (result.status !== 'COMPILED') throw new Error('Expected compiled result.')
        const routerOperation = result.operations.find((operation) =>
            operation.type === FlowOperationType.ADD_ACTION
            && operation.request.action.type === FlowActionType.ROUTER,
        )
        if (routerOperation?.type !== FlowOperationType.ADD_ACTION) throw new Error('Expected router action.')
        const router = routerOperation.request.action
        if (router.type !== FlowActionType.ROUTER) throw new Error('Expected router.')
        const branch = router.settings.branches[0]
        if (branch?.branchType !== 'CONDITION') throw new Error('Expected condition branch.')
        expect(branch.conditions[0]?.[0]?.firstValue).toBe('{{aa_step_001[\'output\'][\'ok\']}}')
    })

    it('rejects unsafe connection external ids before flow creation', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: baseEventAutomation(),
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            connectionBindings: {
                'activepieces:trigger:@activepieces/piece-github:new_issue': 'github[\'bad\']',
                'activepieces:action:@activepieces/piece-github:add_label': 'github-main',
            },
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'FAILED',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'INVALID_CONNECTION_BINDING',
                }),
            ]),
        }))
    })

    it('rejects numeric NOT_EQUALS instead of approximating its semantics', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: {
                schemaVersion: '1',
                name: 'Numeric inequality',
                goal: 'Compare numbers safely.',
                trigger: {
                    type: 'SCHEDULE',
                    cron: '0 * * * *',
                    next: 'condition',
                },
                steps: [{
                    id: 'condition',
                    name: 'Not equal',
                    type: 'CONDITION',
                    expression: {
                        left: 1,
                        operator: 'NOT_EQUALS',
                        right: 2,
                    },
                }],
            },
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'FAILED',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'UNSUPPORTED_CONDITION',
                    stepId: 'condition',
                }),
            ]),
        }))
    })

    it('rejects cross-branch references that are not guaranteed to dominate the consumer', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: {
                schemaVersion: '1',
                name: 'Unsafe branch reference',
                goal: 'Do not read outputs from a sibling branch.',
                trigger: {
                    type: 'EVENT',
                    capability: 'activepieces:trigger:@activepieces/piece-github:new_issue',
                    input: { repository: 'acme/api' },
                    next: 'condition',
                },
                steps: [
                    {
                        id: 'condition',
                        name: 'Condition',
                        type: 'CONDITION',
                        expression: { left: true, operator: 'IS_TRUE' },
                        ifTrue: 'true_step',
                        ifFalse: 'false_step',
                    },
                    {
                        id: 'true_step',
                        name: 'True step',
                        type: 'ACTION',
                        capability: 'activepieces:action:@activepieces/piece-github:add_label',
                        input: { issueId: '1', label: 'true' },
                    },
                    {
                        id: 'false_step',
                        name: 'False step',
                        type: 'ACTION',
                        capability: 'activepieces:action:@activepieces/piece-github:send_comment',
                        input: {
                            issueId: '1',
                            body: {
                                kind: 'REFERENCE',
                                source: 'STEP',
                                stepId: 'true_step',
                                path: ['result'],
                            },
                        },
                    },
                ],
            },
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            connectionBindings: {
                'activepieces:trigger:@activepieces/piece-github:new_issue': 'github-main',
                'activepieces:action:@activepieces/piece-github:add_label': 'github-main',
                'activepieces:action:@activepieces/piece-github:send_comment': 'github-main',
            },
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'FAILED',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'NON_DOMINATING_REFERENCE',
                    stepId: 'false_step',
                }),
            ]),
        }))
    })

    it('rejects stale or invisible capabilities during project-scoped re-resolution', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies({}))
        const result = await compiler.compile({
            automation: baseEventAutomation(),
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'FAILED',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'PIECE_NOT_VISIBLE_OR_MISSING',
                }),
            ]),
        }))
    })

    it('rejects unsupported AI decisions and approval gates instead of approximating them', async () => {
        const compiler = createActivepiecesIrCompiler(dependencies())
        const result = await compiler.compile({
            automation: {
                schemaVersion: '1',
                name: 'AI branch',
                goal: 'Choose.',
                trigger: {
                    type: 'SCHEDULE',
                    cron: '0 * * * *',
                    next: 'decide',
                },
                steps: [{
                    id: 'decide',
                    name: 'Decide',
                    type: 'AI_DECISION',
                    instruction: 'Choose a route.',
                    input: {},
                    routes: [{
                        key: 'yes',
                        description: 'Yes',
                    }],
                }],
            },
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'FAILED',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'UNSUPPORTED_STEP',
                    stepId: 'decide',
                }),
            ]),
        }))
    })
})

describe('Activepieces draft materializer', () => {
    function runtime(overrides: Partial<ActivepiecesDraftCompilerDependencies> = {}) {
        const calls: FlowOperationType[] = []
        const dependencies: ActivepiecesDraftCompilerDependencies = {
            compile: async () => ({
                status: 'COMPILED',
                createRequest: {
                    displayName: 'Compiled flow',
                    projectId: PROJECT_ID,
                },
                operations: [{
                    type: FlowOperationType.UPDATE_TRIGGER,
                    request: {
                        name: 'trigger',
                        displayName: 'Schedule',
                        valid: true,
                        type: FlowTriggerType.PIECE,
                        settings: {
                            pieceName: '@activepieces/piece-schedule',
                            pieceVersion: '0.1.22',
                            triggerName: 'cron_expression',
                            input: {
                                cronExpression: '0 * * * *',
                                timezone: 'UTC',
                            },
                            propertySettings: {},
                        },
                    },
                }],
                stepNameById: {},
                diagnostics: [],
            }),
            createFlow: async () => ({
                id: 'flow-1',
                status: FlowStatus.DISABLED,
                publishedVersionId: null,
                version: {
                    valid: true,
                    trigger: {
                        name: 'trigger',
                        displayName: 'Schedule',
                        valid: true,
                        lastUpdatedDate: NOW,
                        type: FlowTriggerType.PIECE,
                        settings: {
                            pieceName: '@activepieces/piece-schedule',
                            pieceVersion: '0.1.22',
                            triggerName: 'cron_expression',
                            input: {},
                            propertySettings: {},
                        },
                    },
                },
            }),
            applyOperation: async ({ operation }) => {
                calls.push(operation.type)
                return {
                    id: 'flow-1',
                    status: FlowStatus.DISABLED,
                    publishedVersionId: null,
                    version: {
                        valid: true,
                        trigger: operation.type === FlowOperationType.UPDATE_TRIGGER
                            ? {
                                ...operation.request,
                                lastUpdatedDate: NOW,
                            }
                            : {
                                name: 'trigger',
                                displayName: 'empty',
                                valid: false,
                                lastUpdatedDate: NOW,
                                type: FlowTriggerType.EMPTY,
                                settings: {},
                            },
                    },
                }
            },
            ...overrides,
        }
        return {
            service: createActivepiecesDraftCompiler(dependencies),
            calls,
        }
    }

    it('creates only a disabled unpublished draft and never emits publish/status operations', async () => {
        const { service, calls } = runtime()
        const result = await service.materialize({
            automation: baseEventAutomation(),
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            userId: 'user-1',
        })

        expect(result).toEqual({
            status: 'COMPLETE_DRAFT',
            flowId: 'flow-1',
            diagnostics: [],
        })
        expect(calls).toEqual([FlowOperationType.UPDATE_TRIGGER])
        expect(calls).not.toContain(FlowOperationType.IMPORT_FLOW)
        expect(calls).not.toContain(FlowOperationType.LOCK_AND_PUBLISH)
        expect(calls).not.toContain(FlowOperationType.CHANGE_STATUS)
    })

    it('does not create an artifact when compilation fails', async () => {
        let created = false
        const { service } = runtime({
            compile: async () => ({
                status: 'FAILED',
                diagnostics: [{
                    code: 'INVALID_CAPABILITY_ID',
                    message: 'bad id',
                }],
            }),
            createFlow: async () => {
                created = true
                throw new Error('should not run')
            },
        })

        const result = await service.materialize({
            automation: {},
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            userId: null,
        })

        expect(result.status).toBe('FAILED_CLEANLY')
        expect(created).toBe(false)
    })

    it('reports failed-with-artifact when an operation fails after flow creation', async () => {
        const { service } = runtime({
            applyOperation: async () => {
                throw new Error('operation failed')
            },
        })

        const result = await service.materialize({
            automation: baseEventAutomation(),
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            userId: null,
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'FAILED_WITH_ARTIFACT',
            flowId: 'flow-1',
        }))
    })

    it('reports partial draft when Activepieces marks the imported version invalid', async () => {
        const { service } = runtime({
            applyOperation: async ({ operation }) => ({
                id: 'flow-1',
                status: FlowStatus.DISABLED,
                publishedVersionId: null,
                version: {
                    valid: false,
                    trigger: operation.type === FlowOperationType.UPDATE_TRIGGER
                        ? {
                            ...operation.request,
                            valid: false,
                            lastUpdatedDate: NOW,
                        }
                        : {
                            name: 'trigger',
                            displayName: 'empty',
                            valid: false,
                            lastUpdatedDate: NOW,
                            type: FlowTriggerType.EMPTY,
                            settings: {},
                        },
                },
            }),
        })

        const result = await service.materialize({
            automation: baseEventAutomation(),
            projectId: PROJECT_ID,
            platformId: PLATFORM_ID,
            userId: null,
        })

        expect(result).toEqual(expect.objectContaining({
            status: 'PARTIAL_DRAFT',
            flowId: 'flow-1',
            invalidSteps: expect.arrayContaining(['trigger']),
        }))
    })
})
