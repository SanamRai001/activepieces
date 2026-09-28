import type { AutomationPolicy } from '@activepieces/automation-architect'
import type { AutomationRiskClass } from '@activepieces/automation-architect'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'

export type AutomationActivationRiskSnapshot = {
    stepName: string
    pieceName: string
    actionName: string
    riskClass: AutomationRiskClass
    rationale: string
}

export type AutomationActivationPolicySnapshot = {
    riskPolicy: AutomationPolicy
    requireSuccessfulSimulation: boolean
}

export type AutomationActivationApproval = {
    id: string
    created: string
    updated: string
    projectId: string
    flowId: string
    flowVersionId: string
    approvedByUserId: string
    approvedAt: string
    simulationRunId: string | null
    policySnapshot: AutomationActivationPolicySnapshot
    riskSnapshot: AutomationActivationRiskSnapshot[]
    policyDigest: string
    riskDigest: string
}

export const AutomationActivationApprovalEntity = new EntitySchema<AutomationActivationApproval>({
    name: 'automation_activation_approval',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        flowId: {
            ...ApIdSchema,
            nullable: false,
        },
        flowVersionId: {
            ...ApIdSchema,
            nullable: false,
        },
        approvedByUserId: {
            ...ApIdSchema,
            nullable: false,
        },
        approvedAt: {
            type: 'timestamp with time zone',
            nullable: false,
        },
        simulationRunId: {
            ...ApIdSchema,
            nullable: true,
        },
        policySnapshot: {
            type: 'jsonb',
            nullable: false,
        },
        riskSnapshot: {
            type: 'jsonb',
            nullable: false,
        },
        policyDigest: {
            type: String,
            length: 64,
            nullable: false,
        },
        riskDigest: {
            type: String,
            length: 64,
            nullable: false,
        },
    },
    indices: [
        {
            name: 'idx_automation_activation_approval_flow_version',
            columns: ['projectId', 'flowId', 'flowVersionId', 'created'],
        },
        {
            name: 'idx_automation_activation_approval_user',
            columns: ['approvedByUserId', 'created'],
        },
    ],
    relations: {},
})
