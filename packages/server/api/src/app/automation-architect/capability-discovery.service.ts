import type { FastifyBaseLogger } from 'fastify'
import { appConnectionService } from '../app-connection/app-connection-service/app-connection-service'
import { pieceMetadataService } from '../pieces/metadata/piece-metadata-service'
import { toolSearchService } from '../tool-search/tool-search.service'
import { createActivepiecesCapabilityDiscoveryService } from './capability-discovery'

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
