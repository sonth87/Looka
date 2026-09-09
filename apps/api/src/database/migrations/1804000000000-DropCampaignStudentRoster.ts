import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `campaign_student_roster` (created by
 * `1802000000000-CampaignStudentRoster.ts`, since deleted along with that
 * whole mechanism — entity/DAO/service/controller/CMS tab). 2026-09-09
 * architecture correction: that table assumed a per-campaign "expected
 * student" roster the kiosk would check a scanned CCCD against. The real
 * source of truth turned out to be `D:\Work\camera_server\response.json` — a
 * full, campaign-agnostic student roster refreshed by an external system —
 * so a CCCD match is now looked up against that file directly (in-memory, in
 * the desktop app's main process; see `apps/desktop/src/main/cccdRoster.ts`),
 * never through this table or any campaign-scoped API route.
 *
 * Verified empty (0 rows, no other table's FK pointing at it) against the
 * real dev DB before writing this migration, per the task's own "check
 * first whether anything else references it" instruction — `IF EXISTS`
 * below is just defensive belt-and-braces on top of that, not a substitute
 * for having checked.
 */
export class DropCampaignStudentRoster1804000000000
  implements MigrationInterface
{
  name = 'DropCampaignStudentRoster1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_student_roster"`);
  }

  /** Recreates the table exactly as `1802000000000-CampaignStudentRoster.ts`'s own `up()` did, for revert symmetry — the entity that once mapped it is gone, but the raw schema is reproduced verbatim here. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "campaign_student_roster" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "student_code" character varying(100) NOT NULL,
        "student_name" character varying(255) NOT NULL,
        "citizen_id" character varying(20) NOT NULL,
        "class_name" character varying(100),
        "major" character varying(255),
        "academic_year" character varying(20),
        CONSTRAINT "PK_campaign_student_roster" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_campaign_student_roster_campaign_citizen" UNIQUE ("campaign_id", "citizen_id"),
        CONSTRAINT "FK_campaign_student_roster_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_student_roster_created_at" ON "campaign_student_roster" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_student_roster_campaign_id" ON "campaign_student_roster" ("campaign_id")`,
    );
  }
}
