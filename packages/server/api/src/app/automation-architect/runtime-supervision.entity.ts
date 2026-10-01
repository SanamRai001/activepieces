import type { Flow, FlowRun, FlowVersion, Project } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'
import type { AutomationActivationAudit } from './activation-audit.entity'

export type AutomationRuntimeSupervisionState =
    | 'OBSERVING'
    | 'HEALTHY'
    | 'UNCLASSIFIED_FAILURE'
    | 'RECOVERED'

export type AutomationRuntimeSupervisionDecision =
    | 'RUN_SUCCEEDED'
    | 'FAILURE_RECORDED'
    | 'RECOVERY_CONFIRMED'
    | 'RUN_CANCELED'

export type AutomationRuntimeSupervision = {
    id: string
    created: string
    updated: string
    projectId: string
    flowId: string
    flowVersionId: string
    activationAuditId: string
    latestRunId: string | null
    state: AutomationRuntimeSupervisionState
    consecutiveFailureCount: number
    recoveryAttemptCount: number
    lastDecision: AutomationRuntimeSupervisionDecision
    humanEscalationRequired: boolean
    lastObservedAt: string
    lastSuccessAt: string | null
    lastFailureAt: string | null
    lastRunStatus: string
    lastFailureStatus: string | null
    lastFailedStepName: string | null
    lastFailureMessage: string | null
}

type AutomationRuntimeSupervisionSchema = AutomationRuntimeSupervision & {
    project: Project
    flow: Flow
    flowVersion: FlowVersion
    activationAudit: AutomationActivationAudit
    latestRun?: FlowRun | null
}

export const AutomationRuntimeSupervisionEntity = new EntitySchema<AutomationRuntimeSupervisionSchema>({
    name: 'automation_runtime_supervision',
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
        activationAuditId: {
            ...ApIdSchema,
            nullable: false,
        },
        latestRunId: {
            ...ApIdSchema,
            nullable: true,
        },
        state: {
            type: String,
            nullable: false,
        },
        consecutiveFailureCount: {
            type: Number,
            nullable: false,
            default: 0,
        },
        recoveryAttemptCount: {
            type: Number,
            nullable: false,
            default: 0,
        },
        lastDecision: {
            type: String,
            nullable: false,
        },
        humanEscalationRequired: {
            type: Boolean,
            nullable: false,
            default: false,
        },
        lastObservedAt: {
            type: 'timestamp with time zone',
            nullable: false,
        },
        lastSuccessAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
        lastFailureAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
        lastRunStatus: {
            type: String,
            nullable: false,
        },
        lastFailureStatus: {
            type: String,
            nullable: true,
        },
        lastFailedStepName: {
            type: String,
            nullable: true,
        },
        lastFailureMessage: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_automation_runtime_supervision_flow_version',
            columns: ['projectId', 'flowId', 'flowVersionId'],
            unique: true,
        },
        {
            name: 'idx_automation_runtime_supervision_state',
            columns: ['projectId', 'state', 'updated'],
        },
        {
            name: 'idx_automation_runtime_supervision_latest_run',
            columns: ['latestRunId'],
        },
    ],
    relations: {
        project: {
            type: 'many-to-one',
            target: 'project',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_automation_runtime_supervision_project',
            },
        },
        flow: {
            type: 'many-to-one',
            target: 'flow',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowId',
                foreignKeyConstraintName: 'fk_automation_runtime_supervision_flow',
            },
        },
        flowVersion: {
            type: 'many-to-one',
            target: 'flow_version',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowVersionId',
                foreignKeyConstraintName: 'fk_automation_runtime_supervision_flow_version',
            },
        },
        activationAudit: {
            type: 'many-to-one',
            target: 'automation_activation_audit',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'activationAuditId',
                foreignKeyConstraintName: 'fk_automation_runtime_supervision_activation_audit',
            },
        },
        latestRun: {
            type: 'many-to-one',
            target: 'flow_run',
            nullable: true,
            onDelete: 'SET NULL',
            joinColumn: {
                name: 'latestRunId',
                foreignKeyConstraintName: 'fk_automation_runtime_supervision_latest_run',
            },
        },
    },
})
