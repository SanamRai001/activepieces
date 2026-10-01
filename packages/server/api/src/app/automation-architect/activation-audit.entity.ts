import type { Flow, FlowVersion, Project } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'

export type AutomationActivationAuditEvent =
    | 'ATTEMPT_STARTED'
    | 'PUBLISHED'
    | 'ACTIVATED'
    | 'FAILED_BEFORE_PUBLISH'
    | 'PUBLISHED_NOT_ENABLED'

export type AutomationActivationAudit = {
    id: string
    created: string
    updated: string
    projectId: string
    flowId: string
    flowVersionId: string
    flowVersionUpdatedAt: string
    actorUserId: string
    approvalId: string | null
    simulationRunId: string | null
    policyDigest: string
    riskDigest: string
    event: AutomationActivationAuditEvent
    occurredAt: string
    failureReason: string | null
}

type AutomationActivationAuditSchema = AutomationActivationAudit & {
    project: Project
    flow: Flow
    flowVersion: FlowVersion
    approval?: import('./activation-approval.entity').AutomationActivationApproval | null
}

export const AutomationActivationAuditEntity = new EntitySchema<AutomationActivationAuditSchema>({
    name: 'automation_activation_audit',
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
            nullable: false,
        },
        actorUserId: {
            ...ApIdSchema,
            nullable: false,
        },
        approvalId: {
            ...ApIdSchema,
            nullable: true,
        },
        simulationRunId: {
            ...ApIdSchema,
            nullable: true,
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
        event: {
            type: String,
            nullable: false,
        },
        occurredAt: {
            type: 'timestamp with time zone',
            nullable: false,
        },
        failureReason: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_automation_activation_audit_flow',
            columns: ['projectId', 'flowId', 'created'],
        },
        {
            name: 'idx_automation_activation_audit_version',
            columns: ['projectId', 'flowId', 'flowVersionId', 'created'],
        },
        {
            name: 'idx_automation_activation_audit_actor',
            columns: ['actorUserId', 'created'],
        },
    ],
    relations: {
        project: {
            type: 'many-to-one',
            target: 'project',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_automation_activation_audit_project',
            },
        },
        flow: {
            type: 'many-to-one',
            target: 'flow',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowId',
                foreignKeyConstraintName: 'fk_automation_activation_audit_flow',
            },
        },
        flowVersion: {
            type: 'many-to-one',
            target: 'flow_version',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowVersionId',
                foreignKeyConstraintName: 'fk_automation_activation_audit_flow_version',
            },
        },
        approval: {
            type: 'many-to-one',
            target: 'automation_activation_approval',
            nullable: true,
            onDelete: 'SET NULL',
            joinColumn: {
                name: 'approvalId',
                foreignKeyConstraintName: 'fk_automation_activation_audit_approval',
            },
        },
    },
})
