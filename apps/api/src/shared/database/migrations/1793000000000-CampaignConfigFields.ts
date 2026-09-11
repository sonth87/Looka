import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * New `campaigns` config fields for the 2026-09-08 pivot (see
 * docs/plans/campaign-config-sso-card-photo-discussion.md §3.1.1): `code`
 * (nullable — a migration can't sanely backfill uniqueness for existing
 * rows, but required going forward at the DTO level), `cohort`, `starts_at`,
 * `quota_planned`, `manual_status`, `record_video_roles`, `card_spec`.
 *
 * Deliberately does NOT touch `capture_mode`/`auto_hold_ms`/
 * `simultaneous_capture` — those are only deprecated (see `Campaign`
 * entity's own doc comments), not dropped, this pass: the existing
 * `GET /v1/devices/config` kiosk-compatibility path still reads them.
 */
export class CampaignConfigFields1793000000000 implements MigrationInterface {
  name = 'CampaignConfigFields1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN "code" character varying(20),
      ADD COLUMN "cohort" character varying(100),
      ADD COLUMN "starts_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "quota_planned" integer,
      ADD COLUMN "manual_status" character varying(10),
      ADD COLUMN "record_video_roles" jsonb,
      ADD COLUMN "card_spec" jsonb,
      ADD CONSTRAINT "UQ_campaigns_code" UNIQUE ("code"),
      ADD CONSTRAINT "CHK_campaigns_manual_status"
        CHECK ("manual_status" IS NULL OR "manual_status" IN ('PAUSED', 'CLOSED'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP CONSTRAINT "CHK_campaigns_manual_status",
      DROP CONSTRAINT "UQ_campaigns_code",
      DROP COLUMN "card_spec",
      DROP COLUMN "record_video_roles",
      DROP COLUMN "manual_status",
      DROP COLUMN "quota_planned",
      DROP COLUMN "starts_at",
      DROP COLUMN "cohort",
      DROP COLUMN "code"
    `);
  }
}
