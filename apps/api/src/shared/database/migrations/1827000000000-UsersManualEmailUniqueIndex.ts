import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan item 14, 2026-09-17 — "gán người vào campaign theo email". A safety
 * net at the DB layer for `FindOrCreateUserByEmailHandler`'s
 * find-then-create: that handler already looks up an existing row by email
 * (case-insensitive) before creating a MANUAL placeholder, so this index
 * should never actually be hit by normal traffic — it exists to make two
 * concurrent calls for the same not-yet-existing email fail safely (one
 * wins, the other gets a clean DB error) instead of silently creating two
 * MANUAL rows for the same person, which `SsoAuthGuard.upsertUser()`'s own
 * merge-by-email logic (`ILike`, `source = 'MANUAL'`) could then only ever
 * merge into one of.
 *
 * Scoped to `source = 'MANUAL'` only, matching exactly what
 * `SsoAuthGuard.upsertUser()` already searches — an SSO/SYNC row sharing an
 * email with another SSO/SYNC row is a different, pre-existing question
 * this migration does not touch.
 */
export class UsersManualEmailUniqueIndex1827000000000 implements MigrationInterface {
  name = 'UsersManualEmailUniqueIndex1827000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_users_manual_email_ci"
      ON "users" (lower("email"))
      WHERE "source" = 'MANUAL'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "UQ_users_manual_email_ci"
    `);
  }
}
