import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `campaigns.eligibility_config` — 2026-09-18 (product feedback: "API điều
 * kiện tiếp nhận... không cần ở màn tạo workflow nữa, thông tin đó sẽ được
 * config trong phần campaign"). Moves "Điều kiện tiếp nhận" off
 * `workflow_versions.config.eligibility` (a workflow is reused across many
 * campaigns; eligibility is inherently specific to one campaign's own
 * roster/integration) onto the campaign itself.
 *
 * Backfill: for every campaign currently pinned to a workflow version
 * (`workflow_version_id`), copy that version's `config->'eligibility'`
 * verbatim into the new column — so an already-running campaign's
 * eligibility behavior does not change the moment this migration runs.
 * A campaign with no workflow pinned (or whose pinned version has no
 * `eligibility` key) gets the `{"mode":"NONE"}` column default instead —
 * this is a deliberate, small behavior clarification: `lookupSubject()`
 * used to silently fall back to `ROSTER` mode for a campaign with no
 * workflow/eligibility configured at all (an accidental default, not a
 * documented one — a brand new campaign with an empty roster would reject
 * every single capture attempt); `NONE` ("ai cũng chụp được") is the more
 * sensible default for "nothing explicitly configured".
 *
 * `down()` drops the column — the workflow_versions rows this was copied
 * from are untouched (their own `eligibility` jsonb key, if the workflow
 * schema still validated it at the time, is still sitting there, just
 * unread by anything after this migration's `up()`), so a rollback does
 * not lose the source data, only the copy.
 */
export class CampaignEligibilityConfig1831000000000
  implements MigrationInterface
{
  name = 'CampaignEligibilityConfig1831000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        ADD COLUMN "eligibility_config" jsonb NOT NULL DEFAULT '{"mode":"NONE"}'::jsonb
    `);

    await queryRunner.query(`
      UPDATE "campaigns" c
         SET "eligibility_config" = wv.config -> 'eligibility'
        FROM "workflow_versions" wv
       WHERE c."workflow_version_id" = wv."id"
         AND wv.config ? 'eligibility'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns" DROP COLUMN "eligibility_config"
    `);
  }
}
