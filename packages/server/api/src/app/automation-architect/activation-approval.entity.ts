import type { AutomationPolicy, AutomationRiskClass } from '@activepieces/automation-architect'
import type { Flow, FlowVersion, Project } from '@activepieces/shared'
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
    project: Project
    flow: Flow
    flowVersion: FlowVersion
    id: string
    created: string
    updated: string
    projectId: string
    flowId: string
    flowVersionId: string
    flowVersionUpdatedAt: string | null
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
        flowVersionUpdatedAt: {
            type: 'timestamp with time zone',
            nullable: true,
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
            name: 'idx_automation_activation_approval_flow',
            columns: ['projectId', 'flowId', 'created'],
        },
        {
            name: 'idx_automation_activation_approval_flow_version',
            columns: ['projectId', 'flowId', 'flowVersionId', 'created'],
        },
        {
            name: 'idx_automation_activation_approval_user',
            columns: ['approvedByUserId', 'created'],
        },
    ],
    relations: {
        project: {
            type: 'many-to-one',
            target: 'project',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_automation_activation_approval_project',
            },
        },
        flow: {
            type: 'many-to-one',
            target: 'flow',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowId',
                foreignKeyConstraintName: 'fk_automation_activation_approval_flow',
            },
        },
        flowVersion: {
            type: 'many-to-one',
            target: 'flow_version',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowVersionId',
                foreignKeyConstraintName: 'fk_automation_activation_approval_flow_version',
            },
        },
    },
})
