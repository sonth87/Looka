import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `campaign_kiosk_assignments` (created by
 * `1815000000000-CampaignExtendedFields.ts`, D-Q4 — "1 người ↔ 1 kiosk per
 * campaign") — 2026-09-18, product decision to decouple campaign access
 * from device pairing entirely.
 *
 * That table served two purposes: (1) an auto-approve side effect on
 * `campaign_members` when a person was paired with a kiosk, (2) a display
 * of "which kiosk is this person currently using." Neither survives this
 * migration:
 * - (1) is replaced by `CampaignMemberService.grant()`
 *   (`POST /v1/campaigns/:id/members/grant`) — a direct, device-agnostic
 *   bulk "cấp quyền" from the CMS's campaign-list page, see that method's
 *   own doc comment.
 * - (2) was never actually load-bearing: a session's own `device_id`/
 *   `operator_user_id` come from the kiosk's device credentials and its
 *   locally-logged-in operator (confirmed via a full repo audit before
 *   this migration was written — `SessionService`, `CaptureReportService`,
 *   `PhotoService` never read this table), and the CMS's device tab now
 *   reads the plain, always-existing `GET /v1/campaigns/:id/devices`
 *   instead, showing each device's own `last_user_id` for "who used this
 *   last" — no pairing table required.
 *
 * No backfill/data preservation needed: the pairing data itself has no
 * further meaning once campaign access no longer depends on it. `down()`
 * only recreates the empty table shape (same columns/constraints/indexes
 * as `1815000000000-CampaignExtendedFields.ts` originally created) for a
 * clean rollback — it does not and cannot restore the dropped rows.
 */
export class DropCampaignKioskAssignments1832000000000
  implements MigrationInterface
{
  name = 'DropCampaignKioskAssignments1832000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_kiosk_assignments"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "campaign_kiosk_assignments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "campaign_id" uuid NOT NULL,
        "device_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "assigned_by_user_id" uuid,
        "assigned_at" timestamptz NOT NULL,
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaign_kiosk_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_campaign_kiosk_assignments_campaign_device" UNIQUE ("campaign_id", "device_id"),
        CONSTRAINT "UQ_campaign_kiosk_assignments_campaign_user" UNIQUE ("campaign_id", "user_id"),
        CONSTRAINT "FK_campaign_kiosk_assignments_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_campaign_kiosk_assignments_device" FOREIGN KEY ("device_id")
          REFERENCES "devices" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_kiosk_assignments_campaign_id" ON "campaign_kiosk_assignments" ("campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_kiosk_assignments_device_id" ON "campaign_kiosk_assignments" ("device_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_kiosk_assignments_user_id" ON "campaign_kiosk_assignments" ("user_id")`,
    );
  }
}
