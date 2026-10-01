import type { QueryRunner } from 'typeorm'
import type { Migration } from '../../migration'

export class AddAutomationActivationAuditAndRevision1859000000000 implements Migration {
    name = 'AddAutomationActivationAuditAndRevision1859000000000'
    breaking = false

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "automation_activation_approval"
            ADD COLUMN IF NOT EXISTS "flowVersionUpdatedAt" TIMESTAMP WITH TIME ZONE
        `)
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "automation_activation_audit" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "flowVersionId" character varying(21) NOT NULL,
                "flowVersionUpdatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "actorUserId" character varying(21) NOT NULL,
                "approvalId" character varying(21),
                "simulationRunId" character varying(21),
                "policyDigest" character varying(64) NOT NULL,
                "riskDigest" character varying(64) NOT NULL,
                "event" character varying NOT NULL,
                "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "failureReason" character varying,
                CONSTRAINT "pk_automation_activation_audit" PRIMARY KEY ("id"),
                CONSTRAINT "fk_automation_activation_audit_project"
                    FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_automation_activation_audit_flow"
                    FOREIGN KEY ("flowId") REFERENCES "flow" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_automation_activation_audit_flow_version"
                    FOREIGN KEY ("flowVersionId") REFERENCES "flow_version" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_automation_activation_audit_approval"
                    FOREIGN KEY ("approvalId") REFERENCES "automation_activation_approval" ("id") ON DELETE SET NULL
            )
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_automation_activation_audit_flow"
            ON "automation_activation_audit" ("projectId", "flowId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_automation_activation_audit_version"
            ON "automation_activation_audit" ("projectId", "flowId", "flowVersionId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_automation_activation_audit_actor"
            ON "automation_activation_audit" ("actorUserId", "created")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS "automation_activation_audit"')
        await queryRunner.query('ALTER TABLE "automation_activation_approval" DROP COLUMN IF EXISTS "flowVersionUpdatedAt"')
    }
}
