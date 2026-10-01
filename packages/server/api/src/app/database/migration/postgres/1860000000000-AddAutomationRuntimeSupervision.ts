import type { QueryRunner } from 'typeorm'
import type { Migration } from '../../migration'

export class AddAutomationRuntimeSupervision1860000000000 implements Migration {
    name = 'AddAutomationRuntimeSupervision1860000000000'
    breaking = false

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "automation_runtime_supervision" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "flowVersionId" character varying(21) NOT NULL,
                "activationAuditId" character varying(21) NOT NULL,
                "latestRunId" character varying(21),
                "state" character varying NOT NULL,
                "consecutiveFailureCount" integer NOT NULL DEFAULT 0,
                "recoveryAttemptCount" integer NOT NULL DEFAULT 0,
                "lastDecision" character varying NOT NULL,
                "humanEscalationRequired" boolean NOT NULL DEFAULT false,
                "lastObservedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "lastSuccessAt" TIMESTAMP WITH TIME ZONE,
                "lastFailureAt" TIMESTAMP WITH TIME ZONE,
                "lastRunStatus" character varying NOT NULL,
                "lastFailureStatus" character varying,
                "lastFailedStepName" character varying,
                "lastFailureMessage" character varying,
                CONSTRAINT "pk_automation_runtime_supervision" PRIMARY KEY ("id"),
                CONSTRAINT "fk_automation_runtime_supervision_project"
                    FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_automation_runtime_supervision_flow"
                    FOREIGN KEY ("flowId") REFERENCES "flow" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_automation_runtime_supervision_flow_version"
                    FOREIGN KEY ("flowVersionId") REFERENCES "flow_version" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_automation_runtime_supervision_activation_audit"
                    FOREIGN KEY ("activationAuditId") REFERENCES "automation_activation_audit" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_automation_runtime_supervision_latest_run"
                    FOREIGN KEY ("latestRunId") REFERENCES "flow_run" ("id") ON DELETE SET NULL
            )
        `)
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "idx_automation_runtime_supervision_flow_version"
            ON "automation_runtime_supervision" ("projectId", "flowId", "flowVersionId")
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_automation_runtime_supervision_state"
            ON "automation_runtime_supervision" ("projectId", "state", "updated")
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_automation_runtime_supervision_latest_run"
            ON "automation_runtime_supervision" ("latestRunId")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS "automation_runtime_supervision"')
    }
}
