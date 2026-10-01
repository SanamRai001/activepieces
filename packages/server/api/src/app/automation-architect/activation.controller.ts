import { Permission } from '@activepieces/core-utils'
import { PrincipalType } from '@activepieces/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { FlowEntity } from '../flows/flow/flow.entity'
import { networkUtils } from '../helper/network-utils'
import { AUTOMATION_ARCHITECT_ACTIVATION_POLICY } from './activation-policy'
import { activationReadinessService } from './activation-readiness.service'
import { explicitActivationService } from './activation.service'

const ActivationRequest = z.object({
    expectedFlowVersionId: z.string().min(1),
    simulationRunId: z.string().min(1).optional(),
})

const flowSecurity = securityAccess.project(
    [PrincipalType.USER],
    Permission.UPDATE_FLOW_STATUS,
    {
        type: ProjectResourceType.TABLE,
        tableName: FlowEntity,
        lookup: {
            paramKey: 'flowId',
            entityField: 'id',
        },
    },
)

export const automationArchitectActivationController: FastifyPluginAsyncZod = async (app) => {
    app.post('/:flowId/approve', {
        config: {
            security: flowSecurity,
        },
        schema: {
            params: z.object({
                flowId: z.string().min(1),
            }),
            body: ActivationRequest,
        },
    }, async (request) => {
        return activationReadinessService(request.log).approve({
            flowId: request.params.flowId,
            projectId: request.projectId,
            expectedFlowVersionId: request.body.expectedFlowVersionId,
            simulationRunId: request.body.simulationRunId,
            policy: AUTOMATION_ARCHITECT_ACTIVATION_POLICY,
            approvedByUserId: request.principal.id,
        })
    })

    app.post('/:flowId/activate', {
        config: {
            security: flowSecurity,
        },
        schema: {
            params: z.object({
                flowId: z.string().min(1),
            }),
            body: ActivationRequest,
        },
    }, async (request) => {
        return explicitActivationService(request.log).activate({
            flowId: request.params.flowId,
            projectId: request.projectId,
            platformId: request.principal.platform.id,
            actorUserId: request.principal.id,
            expectedFlowVersionId: request.body.expectedFlowVersionId,
            simulationRunId: request.body.simulationRunId,
            ip: networkUtils.clientIp(request),
        })
    })
}
