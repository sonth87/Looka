import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `eligibility_check_logs` — cms-8-screens-api-plan.md §2.3, the table
 * `workflow-config.schema.ts`'s own doc comment named as P3+ scope
 * ("rule EXECUTION against real roster/session data is P3 scope
 * (campaign_subjects/eligibility_check_logs)"), built once the real
 * eligibility-rule-execution pass actually lands (post-P6 cleanup, not P3
 * itself — `CampaignSubjectService.lookupSubject`'s own doc comment had
 * explicitly deferred `EXTERNAL_API`/`ROSTER_AND_API` at P3 time).
 *
 * One row per `GET /v1/campaigns/:id/subjects/lookup` call — an audit trail
 * of what a kiosk actually saw, not just the final answer: `context` is the
 * merged data (roster fields + external-API fields, whichever were in play
 * for that `mode`) the rule expressions were evaluated against, so a
 * disputed "tại sao SV này bị từ chối" can be answered from this table
 * without needing to reproduce the external API call. No FK to
 * `campaigns` — same module-boundary-adjacent reasoning campaign_subjects
 * itself already has an FK to campaigns (same module, device-management
 * owns both), so an FK here is fine and used.
 */
export class EligibilityCheckLogs1819000000000 implements MigrationInterface {
  name = 'EligibilityCheckLogs1819000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "eligibility_check_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "key" character varying(100) NOT NULL,
        "mode" character varying(20) NOT NULL,
        "source" character varying(20) NOT NULL,
        "eligible" boolean NOT NULL,
        "reason" text,
        "context" jsonb,
        "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_eligibility_check_logs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_eligibility_check_logs_mode" CHECK ("mode" IN ('NONE', 'ROSTER', 'EXTERNAL_API', 'ROSTER_AND_API')),
        CONSTRAINT "CHK_eligibility_check_logs_source" CHECK ("source" IN ('NONE', 'ROSTER', 'EXTERNAL_API')),
        CONSTRAINT "FK_eligibility_check_logs_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_eligibility_check_logs_campaign_id" ON "eligibility_check_logs" ("campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eligibility_check_logs_key" ON "eligibility_check_logs" ("campaign_id", "key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "eligibility_check_logs"`);
  }
}
