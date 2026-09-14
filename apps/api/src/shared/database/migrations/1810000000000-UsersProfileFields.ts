import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Profile fields for the "Người dùng & phân quyền" screen
 * (cms-8-screens-api-plan.md §2.8): a manually-added user needs a title,
 * an internal code, a phone number, and an avatar, plus a way to tell a
 * disabled account from an active one and where the row came from.
 *
 * `code` is nullable + unique (a SSO-only login never sets one).
 * `status`/`source` are `varchar` + CHECK, matching this codebase's
 * existing convention (`campaigns.manual_status`, `devices.status` before
 * its enum type) rather than a Postgres enum type — cheaper to extend
 * later.
 */
export class UsersProfileFields1810000000000 implements MigrationInterface {
  name = 'UsersProfileFields1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "title" character varying(255),
        ADD COLUMN "code" character varying(50),
        ADD COLUMN "phone" character varying(20),
        ADD COLUMN "avatar_fs_file_id" uuid,
        ADD COLUMN "status" character varying(10) NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN "source" character varying(10) NOT NULL DEFAULT 'SSO'
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "UQ_users_code" UNIQUE ("code"),
        ADD CONSTRAINT "CHK_users_status" CHECK ("status" IN ('ACTIVE', 'DISABLED')),
        ADD CONSTRAINT "CHK_users_source" CHECK ("source" IN ('SSO', 'MANUAL', 'SYNC'))
    `);
    // Every existing row logged in via SSO at least once (that is how
    // `users` rows are created today, see `SsoAuthGuard.upsertUser`) —
    // backfill explicitly rather than relying on the column default alone,
    // so `source` is meaningful data, not just "whatever the default was
    // when this row happened to be created".
    await queryRunner.query(`UPDATE "users" SET "source" = 'SSO'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT "CHK_users_source",
        DROP CONSTRAINT "CHK_users_status",
        DROP CONSTRAINT "UQ_users_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "source",
        DROP COLUMN "status",
        DROP COLUMN "avatar_fs_file_id",
        DROP COLUMN "phone",
        DROP COLUMN "code",
        DROP COLUMN "title"
    `);
  }
}
