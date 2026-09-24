import { ActionClassification } from '@activepieces/pieces-framework'
import { describe, expect, it } from 'vitest'
import {
    ActivepiecesCapabilityDiscoveryDependencies,
    createActivepiecesCapabilityDiscoveryService,
} from '../../../src/app/automation-architect/capability-discovery.service'

const project = {
    platformId: 'platform-1',
    projectId: 'project-1',
}

function createDependencies(overrides: Partial<ActivepiecesCapabilityDiscoveryDependencies> = {}): ActivepiecesCapabilityDiscoveryDependencies {
    return {
        searchActions: async () => ({
            mode: 'semantic',
            results: [],
        }),
        searchTriggers: async () => ({
            mode: 'semantic',
            results: [],
        }),
        getPiece: async () => undefined,
        ...overrides,
    }
}

function piece(params?: {
    actionClassification?: ActionClassification
    includeAction?: boolean
    includeTrigger?: boolean
}) {
    const includeAction = params?.includeAction ?? true
    const includeTrigger = params?.includeTrigger ?? true

    return {
        name: '@activepieces/piece-example',
        displayName: 'Example',
        actions: includeAction
            ? {
                write_item: {
                    name: 'write_item',
                    displayName: 'Write Item',
                    description: 'Writes an item.',
                    classification: params?.actionClassification,
                },
            }
            : {},
        triggers: includeTrigger
            ? {
                new_item: {
                    name: 'new_item',
                    displayName: 'New Item',
                    description: 'Runs when an item is created.',
                },
            }
            : {},
    }
}

describe('Activepieces capability discovery adapter', () => {
    it('maps project-scoped trigger and action results into planner capabilities', async () => {
        const service = createActivepiecesCapabilityDiscoveryService(createDependencies({
            searchTriggers: async () => ({
                mode: 'semantic',
                results: [{
                    pieceName: '@activepieces/piece-example',
                    triggerName: 'new_item',
                    displayName: 'New Item',
                    oneLineDescription: 'When an item is created.',
                    requiresConnection: true,
                    connected: true,
                    cosine: 0.91,
                }],
            }),
            searchActions: async () => ({
                mode: 'semantic',
                results: [{
                    pieceName: '@activepieces/piece-example',
                    actionName: 'write_item',
                    displayName: 'Write Item',
                    oneLineDescription: 'Write an item.',
                    requiresConnection: true,
                    connected: true,
                    cosine: 0.88,
                }],
            }),
            getPiece: async () => piece({ actionClassification: 'WRITE' }),
        }))

        const result = await service.discover({
            query: 'when an item arrives write it somewhere',
            ...project,
        })

        expect(result.capabilities).toEqual([
            expect.objectContaining({
                id: 'activepieces:trigger:@activepieces/piece-example:new_item',
                kind: 'TRIGGER',
                connection: {
                    required: true,
                    available: true,
                    label: 'Example',
                },
            }),
            expect.objectContaining({
                id: 'activepieces:action:@activepieces/piece-example:write_item',
                kind: 'ACTION',
                risk: expect.objectContaining({
                    class: 'SENSITIVE_MUTATION',
                }),
            }),
        ])
        expect(result.issues).toEqual([])
    })

    it('passes project scope to metadata resolution so visibility remains enforced', async () => {
        const lookups: Array<{ name: string, platformId: string, projectId: string }> = []
        const service = createActivepiecesCapabilityDiscoveryService(createDependencies({
            searchActions: async () => ({
                mode: 'semantic',
                results: [{
                    pieceName: '@activepieces/piece-example',
                    actionName: 'write_item',
                    displayName: 'Write Item',
                    oneLineDescription: 'Write an item.',
                    requiresConnection: false,
                    connected: undefined,
                }],
            }),
            getPiece: async (params) => {
                lookups.push(params)
                return piece({ actionClassification: 'WRITE' })
            },
        }))

        await service.discover({
            query: 'write item',
            ...project,
            kinds: ['ACTION'],
        })

        expect(lookups).toEqual([{
            name: '@activepieces/piece-example',
            platformId: project.platformId,
            projectId: project.projectId,
        }])
    })

    it('drops stale search results when the piece is missing or not visible', async () => {
        const service = createActivepiecesCapabilityDiscoveryService(createDependencies({
            searchActions: async () => ({
                mode: 'semantic',
                results: [{
                    pieceName: '@activepieces/piece-hidden',
                    actionName: 'secret_action',
                    displayName: 'Secret Action',
                    oneLineDescription: 'Hidden.',
                    requiresConnection: false,
                }],
            }),
        }))

        const result = await service.discover({
            query: 'secret',
            ...project,
            kinds: ['ACTION'],
        })

        expect(result.capabilities).toEqual([])
        expect(result.issues).toEqual([
            expect.objectContaining({
                code: 'PIECE_NOT_VISIBLE_OR_MISSING',
                pieceName: '@activepieces/piece-hidden',
            }),
        ])
    })

    it('drops stale component matches that no longer exist on resolved metadata', async () => {
        const service = createActivepiecesCapabilityDiscoveryService(createDependencies({
            searchActions: async () => ({
                mode: 'semantic',
                results: [{
                    pieceName: '@activepieces/piece-example',
                    actionName: 'removed_action',
                    displayName: 'Removed',
                    oneLineDescription: 'Removed.',
                    requiresConnection: false,
                }],
            }),
            getPiece: async () => piece({ includeAction: false }),
        }))

        const result = await service.discover({
            query: 'removed',
            ...project,
            kinds: ['ACTION'],
        })

        expect(result.capabilities).toEqual([])
        expect(result.issues[0]).toEqual(expect.objectContaining({
            code: 'COMPONENT_NOT_FOUND',
            componentName: 'removed_action',
        }))
    })

    it('marks required connections unavailable unless the search layer confirms an active connection', async () => {
        const service = createActivepiecesCapabilityDiscoveryService(createDependencies({
            searchActions: async () => ({
                mode: 'semantic',
                results: [{
                    pieceName: '@activepieces/piece-example',
                    actionName: 'write_item',
                    displayName: 'Write Item',
                    oneLineDescription: 'Write.',
                    requiresConnection: true,
                    connected: undefined,
                }],
            }),
            getPiece: async () => piece({ actionClassification: 'WRITE' }),
        }))

        const result = await service.discover({
            query: 'write',
            ...project,
            kinds: ['ACTION'],
        })

        expect(result.capabilities[0]?.connection).toEqual({
            required: true,
            available: false,
            label: 'Example',
        })
    })

    it.each([
        ['READ', 'READ_ONLY'],
        ['SEARCH', 'READ_ONLY'],
        ['WRITE', 'SENSITIVE_MUTATION'],
        ['DESTRUCTIVE', 'DESTRUCTIVE'],
        [undefined, 'SENSITIVE_MUTATION'],
    ] as const)('maps action classification %s to risk %s', async (classification, expectedRisk) => {
        const service = createActivepiecesCapabilityDiscoveryService(createDependencies({
            searchActions: async () => ({
                mode: 'semantic',
                results: [{
                    pieceName: '@activepieces/piece-example',
                    actionName: 'write_item',
                    displayName: 'Write Item',
                    oneLineDescription: 'Action.',
                    requiresConnection: false,
                }],
            }),
            getPiece: async () => piece({ actionClassification: classification }),
        }))

        const result = await service.discover({
            query: 'action',
            ...project,
            kinds: ['ACTION'],
        })

        expect(result.capabilities[0]?.risk?.class).toBe(expectedRisk)
    })

    it('reports keyword fallback without rejecting otherwise valid capabilities', async () => {
        const service = createActivepiecesCapabilityDiscoveryService(createDependencies({
            searchTriggers: async () => ({
                mode: 'keyword',
                degradeReason: 'no-embedder',
                results: [{
                    pieceName: '@activepieces/piece-example',
                    triggerName: 'new_item',
                    displayName: 'New Item',
                    oneLineDescription: 'When an item is created.',
                    requiresConnection: false,
                }],
            }),
            getPiece: async () => piece(),
        }))

        const result = await service.discover({
            query: 'new item',
            ...project,
            kinds: ['TRIGGER'],
        })

        expect(result.capabilities).toHaveLength(1)
        expect(result.issues).toEqual([
            expect.objectContaining({
                code: 'SEARCH_DEGRADED',
                message: expect.stringContaining('keyword fallback'),
            }),
        ])
        expect(result.searchModes.triggers).toBe('keyword')
    })

    it('deduplicates repeated search hits and caches metadata lookup per piece', async () => {
        let metadataCalls = 0
        const resultRow = {
            pieceName: '@activepieces/piece-example',
            actionName: 'write_item',
            displayName: 'Write Item',
            oneLineDescription: 'Write.',
            requiresConnection: false,
        }

        const service = createActivepiecesCapabilityDiscoveryService(createDependencies({
            searchActions: async () => ({
                mode: 'semantic',
                results: [resultRow, resultRow],
            }),
            getPiece: async () => {
                metadataCalls += 1
                return piece({ actionClassification: 'WRITE' })
            },
        }))

        const result = await service.discover({
            query: 'write',
            ...project,
            kinds: ['ACTION'],
        })

        expect(result.capabilities).toHaveLength(1)
        expect(metadataCalls).toBe(1)
    })

    it('does not search a capability kind excluded by the caller', async () => {
        let actionSearchCalled = false
        const service = createActivepiecesCapabilityDiscoveryService(createDependencies({
            searchActions: async () => {
                actionSearchCalled = true
                return { mode: 'semantic', results: [] }
            },
            searchTriggers: async () => ({
                mode: 'semantic',
                results: [],
            }),
        }))

        await service.discover({
            query: 'new item',
            ...project,
            kinds: ['TRIGGER'],
        })

        expect(actionSearchCalled).toBe(false)
    })
})
