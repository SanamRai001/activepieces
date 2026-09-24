import { PlannerCapability } from '@activepieces/automation-architect'
import { ActionClassification } from '@activepieces/pieces-framework'
import { FastifyBaseLogger } from 'fastify'
import { appConnectionService } from '../app-connection/app-connection-service/app-connection-service'
import { pieceMetadataService } from '../pieces/metadata/piece-metadata-service'
import {
    toolSearchService,
    ToolSearchActionResult,
    ToolSearchActionResponse,
    ToolSearchTriggerResult,
    ToolSearchTriggerResponse,
} from '../tool-search/tool-search.service'

const DEFAULT_LIMIT_PER_KIND = 5

export type ActivepiecesCapabilityKind = 'ACTION' | 'TRIGGER'

export type ActivepiecesCapabilityDiscoveryIssueCode =
    | 'SEARCH_DEGRADED'
    | 'PIECE_NOT_VISIBLE_OR_MISSING'
    | 'COMPONENT_NOT_FOUND'
    | 'CAPABILITY_ID_TOO_LONG'
    | 'CONNECTION_STATUS_UNAVAILABLE'

export type ActivepiecesCapabilityDiscoveryIssue = {
    code: ActivepiecesCapabilityDiscoveryIssueCode
    message: string
    pieceName?: string
    componentName?: string
}

export type ActivepiecesCapabilityDiscoveryResult = {
    capabilities: PlannerCapability[]
    issues: ActivepiecesCapabilityDiscoveryIssue[]
    searchModes: {
        actions?: 'semantic' | 'keyword'
        triggers?: 'semantic' | 'keyword'
    }
}

export type ActivepiecesCapabilityDiscoveryParams = {
    query: string
    platformId: string
    projectId: string
    kinds?: ActivepiecesCapabilityKind[]
    limitPerKind?: number
}

type SearchParams = {
    platformId: string
    projectId: string
    limit?: number
}

type ComponentMetadata = {
    name: string
    displayName: string
    description: string
    classification?: ActionClassification
}

type PieceMetadata = {
    name: string
    displayName: string
    actions: Record<string, ComponentMetadata>
    triggers: Record<string, ComponentMetadata>
}

export type ActivepiecesCapabilityDiscoveryDependencies = {
    searchActions(query: string, params: SearchParams): Promise<ToolSearchActionResponse>
    searchTriggers(query: string, params: SearchParams): Promise<ToolSearchTriggerResponse>
    getPiece(params: {
        name: string
        platformId: string
        projectId: string
    }): Promise<PieceMetadata | undefined>
    listConnectedPieceNames(params: {
        platformId: string
        projectId: string
    }): Promise<ReadonlySet<string>>
}

export const activepiecesCapabilityDiscoveryService = (log: FastifyBaseLogger) => {
    const search = toolSearchService(log)
    const metadata = pieceMetadataService(log)
    const connections = appConnectionService(log)

    return createActivepiecesCapabilityDiscoveryService({
        searchActions: (query, params) => search.searchActions(query, params),
        searchTriggers: (query, params) => search.searchTriggers(query, params),
        getPiece: ({ name, platformId, projectId }) => metadata.get({
            name,
            platformId,
            projectId,
        }),
        listConnectedPieceNames: async ({ platformId, projectId }) => {
            const connected = await connections.listConnectedPieces({
                platformId,
                projectId,
                limit: 1000,
            })
            return new Set(connected.map((connection) => connection.pieceName))
        },
    })
}

export const createActivepiecesCapabilityDiscoveryService = (
    dependencies: ActivepiecesCapabilityDiscoveryDependencies,
) => ({
    async discover(params: ActivepiecesCapabilityDiscoveryParams): Promise<ActivepiecesCapabilityDiscoveryResult> {
        const kinds = params.kinds ?? ['TRIGGER', 'ACTION']
        const query = params.query.trim()
        if (query.length === 0) {
            throw new Error('Capability discovery query must not be empty.')
        }
        const limit = Math.min(Math.max(params.limitPerKind ?? DEFAULT_LIMIT_PER_KIND, 1), 20)
        const searchParams = {
            platformId: params.platformId,
            projectId: params.projectId,
            limit,
        }

        const [triggerResponse, actionResponse, connectionState] = await Promise.all([
            kinds.includes('TRIGGER')
                ? dependencies.searchTriggers(query, searchParams)
                : Promise.resolve<ToolSearchTriggerResponse | undefined>(undefined),
            kinds.includes('ACTION')
                ? dependencies.searchActions(query, searchParams)
                : Promise.resolve<ToolSearchActionResponse | undefined>(undefined),
            resolveConnectedPieceNames(dependencies, params),
        ])

        const connectedPieceNames = connectionState.pieceNames
        const issues: ActivepiecesCapabilityDiscoveryIssue[] = []
        if (connectionState.error !== undefined) {
            issues.push({
                code: 'CONNECTION_STATUS_UNAVAILABLE',
                message: 'Project connection state could not be resolved. Authenticated capabilities are treated as unavailable until connection status is confirmed.',
            })
        }
        appendDegradeIssue('trigger', triggerResponse, issues)
        appendDegradeIssue('action', actionResponse, issues)

        const candidates: Candidate[] = [
            ...(triggerResponse?.results ?? []).map((result) => ({
                kind: 'TRIGGER' as const,
                pieceName: result.pieceName,
                componentName: result.triggerName,
                displayName: result.displayName,
                description: result.oneLineDescription,
                requiresConnection: result.requiresConnection,
            })),
            ...(actionResponse?.results ?? []).map((result) => ({
                kind: 'ACTION' as const,
                pieceName: result.pieceName,
                componentName: result.actionName,
                displayName: result.displayName,
                description: result.oneLineDescription,
                requiresConnection: result.requiresConnection,
            })),
        ]

        const pieceCache = new Map<string, Promise<PieceMetadata | undefined>>()
        const capabilities: PlannerCapability[] = []

        for (const candidate of candidates) {
            const piece = await getPieceCached({
                candidate,
                params,
                pieceCache,
                getPiece: dependencies.getPiece,
            })

            if (piece === undefined) {
                issues.push({
                    code: 'PIECE_NOT_VISIBLE_OR_MISSING',
                    message: `Piece "${candidate.pieceName}" is unavailable in this project scope.`,
                    pieceName: candidate.pieceName,
                    componentName: candidate.componentName,
                })
                continue
            }

            const component = candidate.kind === 'ACTION'
                ? piece.actions[candidate.componentName]
                : piece.triggers[candidate.componentName]

            if (component === undefined) {
                issues.push({
                    code: 'COMPONENT_NOT_FOUND',
                    message: `${candidate.kind.toLowerCase()} "${candidate.componentName}" is unavailable on piece "${candidate.pieceName}".`,
                    pieceName: candidate.pieceName,
                    componentName: candidate.componentName,
                })
                continue
            }

            const capabilityId = createCapabilityId(candidate)
            if (capabilityId.length > 200) {
                issues.push({
                    code: 'CAPABILITY_ID_TOO_LONG',
                    message: `Capability id for "${candidate.pieceName}/${candidate.componentName}" exceeds the planner contract limit.`,
                    pieceName: candidate.pieceName,
                    componentName: candidate.componentName,
                })
                continue
            }

            capabilities.push({
                id: capabilityId,
                kind: candidate.kind,
                name: component.displayName || candidate.displayName,
                description: component.description || candidate.description || `${component.displayName} from ${piece.displayName}`,
                connection: {
                    required: candidate.requiresConnection,
                    available: !candidate.requiresConnection || connectedPieceNames.has(candidate.pieceName),
                    label: piece.displayName,
                },
                ...(candidate.kind === 'ACTION'
                    ? { risk: resolveActionRisk(component.classification) }
                    : {}),
            })
        }

        return {
            capabilities: deduplicateCapabilities(capabilities),
            issues,
            searchModes: {
                ...(actionResponse ? { actions: actionResponse.mode } : {}),
                ...(triggerResponse ? { triggers: triggerResponse.mode } : {}),
            },
        }
    },
})

type Candidate = {
    kind: ActivepiecesCapabilityKind
    pieceName: string
    componentName: string
    displayName: string
    description: string | undefined
    requiresConnection: boolean
}

function createCapabilityId(candidate: Candidate): string {
    return `activepieces:${candidate.kind.toLowerCase()}:${candidate.pieceName}:${candidate.componentName}`
}

function resolveActionRisk(classification: ActionClassification | undefined): PlannerCapability['risk'] {
    switch (classification) {
        case 'READ':
        case 'SEARCH':
            return {
                class: 'READ_ONLY',
                rationale: `Activepieces classifies this action as ${classification}.`,
            }
        case 'DESTRUCTIVE':
            return {
                class: 'DESTRUCTIVE',
                rationale: 'Activepieces classifies this action as DESTRUCTIVE.',
            }
        case 'WRITE':
            return {
                class: 'SENSITIVE_MUTATION',
                rationale: 'Activepieces classifies this action as WRITE; Automation Architect conservatively treats generic writes as sensitive mutations until a narrower deterministic classifier exists.',
            }
        case undefined:
            return {
                class: 'SENSITIVE_MUTATION',
                rationale: 'This action has no Activepieces classification; Automation Architect conservatively treats unclassified actions as sensitive mutations.',
            }
    }
}

function deduplicateCapabilities(capabilities: PlannerCapability[]): PlannerCapability[] {
    const seen = new Set<string>()
    return capabilities.filter((capability) => {
        if (seen.has(capability.id)) {
            return false
        }
        seen.add(capability.id)
        return true
    })
}

function appendDegradeIssue(
    kind: 'action' | 'trigger',
    response: ToolSearchActionResponse | ToolSearchTriggerResponse | undefined,
    issues: ActivepiecesCapabilityDiscoveryIssue[],
): void {
    if (response?.mode !== 'keyword') {
        return
    }

    const reason = response.degradeReason === 'embed-failed'
        ? 'the embedding search failed'
        : 'no embedding model is configured'

    issues.push({
        code: 'SEARCH_DEGRADED',
        message: `${kind} discovery used keyword fallback because ${reason}.`,
    })
}

async function getPieceCached(params: {
    candidate: Candidate
    params: ActivepiecesCapabilityDiscoveryParams
    pieceCache: Map<string, Promise<PieceMetadata | undefined>>
    getPiece: ActivepiecesCapabilityDiscoveryDependencies['getPiece']
}): Promise<PieceMetadata | undefined> {
    const existing = params.pieceCache.get(params.candidate.pieceName)
    if (existing !== undefined) {
        return existing
    }

    const lookup = params.getPiece({
        name: params.candidate.pieceName,
        platformId: params.params.platformId,
        projectId: params.params.projectId,
    })
    params.pieceCache.set(params.candidate.pieceName, lookup)
    return lookup
}


async function resolveConnectedPieceNames(
    dependencies: ActivepiecesCapabilityDiscoveryDependencies,
    params: ActivepiecesCapabilityDiscoveryParams,
): Promise<{ pieceNames: ReadonlySet<string>, error?: unknown }> {
    try {
        return {
            pieceNames: await dependencies.listConnectedPieceNames({
                platformId: params.platformId,
                projectId: params.projectId,
            }),
        }
    }
    catch (error) {
        return {
            pieceNames: new Set<string>(),
            error,
        }
    }
}
