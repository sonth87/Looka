import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Ghi nhận cán bộ chụp trên phiên" — see
 * docs/plans/campaign-config-sso-card-photo-discussion.md §3.2.3. Without
 * this column, neither "ai chụp bao nhiêu" statistics nor audit of who ran a
 * session are possible.
 *
 * No FK to `users`: referential integrity to that table is not critical
 * here (a deleted/renamed user must never retroactively break a historical
 * session row), and a cross-module FK from `capture`'s `sessions` table into
 * the `shared` module's `users` table is avoided on purpose - same
 * `device_id`/`campaign_id` precedent from `CaptureRecords1787900000000`
 * intentionally used a real FK for those (device-management owns both
 * referenced tables), but `users` sits in a different module boundary and
 * this column only ever needs to carry the id, not enforce it exists.
 *
 * Nullable: both the web `POST /v1/sessions` DTO field and the kiosk
 * SESSION_REPORT payload field are optional (older kiosk builds, and web
 * callers with no SSO context, simply omit it).
 */
export class SessionOperatorUser1796000000000 implements MigrationInterface {
  name = 'SessionOperatorUser1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sessions"
        ADD COLUMN "operator_user_id" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sessions"
        DROP COLUMN "operator_user_id"
    `);
  }
}
