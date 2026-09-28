import type { QueryRunner } from 'typeorm'
import type { Migration } from '../../migration'

export class AddAutomationActivationApproval1858000000000 implements Migration {
    name = 'AddAutomationActivationApproval1858000000000'
    breaking = false

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "automation_activation_approval" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "flowVersionId" character varying(21) NOT NULL,
                "approvedByUserId" character varying(21) NOT NULL,
                "approvedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "simulationRunId" character varying(21),
                "policySnapshot" jsonb NOT NULL,
                "riskSnapshot" jsonb NOT NULL,
                "policyDigest" character varying(64) NOT NULL,
                "riskDigest" character varying(64) NOT NULL,
                CONSTRAINT "pk_automation_activation_approval" PRIMARY KEY ("id"),
                CONSTRAINT "fk_automation_activation_approval_project"
                    FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_automation_activation_approval_flow"
                    FOREIGN KEY ("flowId") REFERENCES "flow" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_automation_activation_approval_flow_version"
                    FOREIGN KEY ("flowVersionId") REFERENCES "flow_version" ("id") ON DELETE CASCADE
            )
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_automation_activation_approval_flow"
            ON "automation_activation_approval" ("projectId", "flowId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_automation_activation_approval_flow_version"
            ON "automation_activation_approval" ("projectId", "flowId", "flowVersionId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_automation_activation_approval_user"
            ON "automation_activation_approval" ("approvedByUserId", "created")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS "automation_activation_approval"')
    }
}
