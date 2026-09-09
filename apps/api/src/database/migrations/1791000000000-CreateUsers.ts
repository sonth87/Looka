import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foundational `users` table for the 2026-09-08 pivot away from device
 * registration toward SSO-login-per-person (see
 * docs/plans/campaign-config-sso-card-photo-discussion.md §2.1-2.3 and
 * §3.2, and cms-photo-review-plan.md §7). Deliberately created ahead of
 * `campaign_members`/photo-review tables (both depend on it) so those can
 * be built independently without a migration-ordering race.
 */
export class CreateUsers1791000000000 implements MigrationInterface {
  name = 'CreateUsers1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "sso_user_code" character varying(100) NOT NULL,
        "email" character varying(255) NOT NULL,
        "display_name" character varying(255),
        "is_admin" boolean NOT NULL DEFAULT false,
        "roles" jsonb NOT NULL DEFAULT '[]',
        "last_login_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_sso_user_code" UNIQUE ("sso_user_code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_users_created_at" ON "users" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_sso_user_code" ON "users" ("sso_user_code")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_email" ON "users" ("email")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
