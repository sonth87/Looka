import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-09-28 product pivot — "Phân công duyệt" (`review_assignments`,
 * `1835000000000-ReviewAssignments.ts`) moves from GLOBAL (no `campaignId`,
 * "0 rows = unrestricted everywhere") to PER-CAMPAIGN
 * (`(userId, campaignId, groupField?, groupValue?)`, "0 rows for a campaign
 * = sees nothing in that campaign"). `groupField`/`groupValue` both `NULL`
 * now means "the whole campaign" (a new grant kind the old schema had no
 * room for); both set narrows to one Lớp/Khoa/Ngành within that campaign,
 * same as before. `campaignId` is a plain uuid with NO FK — this module's
 * consistent "never FK a cross-module id" convention (see
 * `SubjectPhotoSet.campaignId`'s own doc comment; `review_assignments`
 * itself already followed this for `userId`).
 *
 * **Preserving current access** (task brief's explicit requirement) — done
 * via a `_ra_before` snapshot of the pre-migration table, taken before any
 * insert, so the "was this user unrestricted" check below always reads the
 * ORIGINAL pre-migration state even after this migration starts adding new
 * per-campaign rows for the very same users:
 *
 * 1. Every existing global GROUP row `(userId, groupField, groupValue)` is
 *    copied into one row PER EXISTING CAMPAIGN — a group grant narrowed
 *    visibility globally before, so it must go on narrowing it in every
 *    campaign that existed at migration time to not silently lose access.
 * 2. Every user who currently holds the `REVIEWER` role AND had ZERO
 *    `review_assignments` rows (i.e. was UNRESTRICTED under the old rule)
 *    gets a whole-campaign row (`groupField`/`groupValue` both `NULL`) for
 *    every existing campaign — the only way to reproduce "sees everything"
 *    under the new strict per-campaign rule.
 *
 * Campaigns created AFTER this migration runs get NO automatic rows for
 * anyone — a human must explicitly assign a reviewer to a new campaign
 * going forward (that is the whole point of this pivot). Admin users need
 * no rows at all (`ReviewAssignmentService` always short-circuits for
 * `users.is_admin`).
 *
 * The OLD unique index (`user_id`, `group_field`, `group_value`) is dropped
 * before any per-campaign copies are inserted — otherwise inserting the
 * SAME `(user, field, value)` once per campaign would immediately violate
 * it (that old index had no `campaign_id` column at all).
 *
 * Postgres 18 confirmed on this project's dev DB (`SELECT version()`) — safe
 * to use `NULLS NOT DISTINCT` (added in PG15) for the new unique index, so
 * "both group columns NULL" (whole-campaign) still collapses to one row per
 * `(user, campaign)` instead of allowing duplicates (NULL <> NULL under the
 * classic SQL unique-index rule).
 */
export class ReviewAssignmentsPerCampaign1838000000000 implements MigrationInterface {
  name = 'ReviewAssignmentsPerCampaign1838000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_assignments" ADD COLUMN "campaign_id" uuid`,
    );
    await queryRunner.query(
      `DROP INDEX "UQ_review_assignments_user_field_value"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_assignments" ALTER COLUMN "group_field" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_assignments" ALTER COLUMN "group_value" DROP NOT NULL`,
    );

    // Snapshot BEFORE any insert — every later "which users/rows existed
    // before this migration" check reads this, never the live table (which
    // starts growing new per-campaign rows for the same users in the very
    // next statement).
    await queryRunner.query(
      `CREATE TEMP TABLE "_ra_before" AS SELECT * FROM "review_assignments"`,
    );

    // (1) Old global GROUP rows → one row per existing campaign.
    await queryRunner.query(`
      INSERT INTO "review_assignments"
        ("user_id", "campaign_id", "group_field", "group_value", "created_by_user_id")
      SELECT ra."user_id", c."id", ra."group_field", ra."group_value", ra."created_by_user_id"
        FROM "_ra_before" ra
        CROSS JOIN "campaigns" c
    `);

    // (2) Previously-UNRESTRICTED reviewers (REVIEWER role, zero rows in the
    // snapshot) → one whole-campaign row (NULL/NULL) per existing campaign.
    await queryRunner.query(`
      INSERT INTO "review_assignments"
        ("user_id", "campaign_id", "group_field", "group_value")
      SELECT u."id", c."id", NULL, NULL
        FROM "users" u
        CROSS JOIN "campaigns" c
       WHERE u."roles" @> '["REVIEWER"]'::jsonb
         AND NOT EXISTS (
           SELECT 1 FROM "_ra_before" ra WHERE ra."user_id" = u."id"
         )
    `);

    // The pre-migration rows themselves are now superseded by their
    // per-campaign copies above.
    await queryRunner.query(
      `DELETE FROM "review_assignments" WHERE "campaign_id" IS NULL`,
    );
    await queryRunner.query(`DROP TABLE "_ra_before"`);

    await queryRunner.query(
      `ALTER TABLE "review_assignments" ALTER COLUMN "campaign_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_review_assignments_user_campaign_field_value" ON "review_assignments" ("user_id", "campaign_id", "group_field", "group_value") NULLS NOT DISTINCT`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_review_assignments_campaign_id" ON "review_assignments" ("campaign_id")`,
    );
  }

  /**
   * Best-effort, documented-lossy: whole-campaign rows (`group_field IS
   * NULL`) have no representation in the old schema at all and are simply
   * dropped. Group rows collapse back to DISTINCT `(user_id, group_field,
   * group_value)` across every campaign they applied to — which campaign(s)
   * a group grant applied to is lost, same as `created_by_user_id`/
   * `created_at` (arbitrarily one of the collapsed rows' own values, via
   * `MIN`, not a meaningful "the" original grant).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_review_assignments_campaign_id"`);
    await queryRunner.query(
      `DROP INDEX "UQ_review_assignments_user_campaign_field_value"`,
    );
    await queryRunner.query(
      `DELETE FROM "review_assignments" WHERE "group_field" IS NULL`,
    );
    await queryRunner.query(`
      CREATE TEMP TABLE "_ra_collapsed" AS
        SELECT "user_id", "group_field", "group_value",
               MIN("created_by_user_id") AS "created_by_user_id"
          FROM "review_assignments"
         GROUP BY "user_id", "group_field", "group_value"
    `);
    await queryRunner.query(`DELETE FROM "review_assignments"`);
    await queryRunner.query(`
      INSERT INTO "review_assignments"
        ("user_id", "group_field", "group_value", "created_by_user_id")
      SELECT "user_id", "group_field", "group_value", "created_by_user_id"
        FROM "_ra_collapsed"
    `);
    await queryRunner.query(`DROP TABLE "_ra_collapsed"`);
    await queryRunner.query(
      `ALTER TABLE "review_assignments" DROP COLUMN "campaign_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_assignments" ALTER COLUMN "group_field" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_assignments" ALTER COLUMN "group_value" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_review_assignments_user_field_value" ON "review_assignments" ("user_id", "group_field", "group_value")`,
    );
  }
}
