import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reverts `1828000000000-CreateEligibilityApiClients.ts` (2026-09-17,
 * same day) — the user rejected a shared, DB-wide catalog of eligibility
 * API clients ("API điều kiện tiếp nhận là config trong workflow luôn chứ
 * không dùng chung như hiện tại"). Every workflow's eligibility API config
 * now lives inline in its own `workflow_versions.config.eligibility.api`
 * jsonb instead — see `eligibility-http.client.ts`'s own doc comment.
 * `down()` recreates the table (same shape the create migration had) so
 * this migration is still reversible, even though nothing in the
 * application writes to it once reverted back in.
 */
export class DropEligibilityApiClients1829000000000 implements MigrationInterface {
  name = 'DropEligibilityApiClients1829000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "eligibility_api_clients"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "eligibility_api_clients" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(64) NOT NULL,
        "name" character varying(255) NOT NULL,
        "base_url" character varying(500) NOT NULL,
        "request_method" character varying(10) NOT NULL DEFAULT 'POST',
        "request_path" character varying(500) NOT NULL,
        "request_body_template" jsonb,
        "auth_type" character varying(20) NOT NULL DEFAULT 'API_KEY_HEADER',
        "auth_param_name" character varying(100),
        "credential_ciphertext" text,
        "key_response_path" character varying(200),
        "sample_response" jsonb,
        "active" boolean NOT NULL DEFAULT true,
        "created_by_user_id" uuid,
        CONSTRAINT "PK_eligibility_api_clients" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_eligibility_api_clients_code" UNIQUE ("code"),
        CONSTRAINT "CHK_eligibility_api_clients_method"
          CHECK ("request_method" IN ('GET', 'POST')),
        CONSTRAINT "CHK_eligibility_api_clients_auth_type"
          CHECK ("auth_type" IN ('NONE', 'API_KEY_HEADER', 'BEARER_TOKEN', 'QUERY_PARAM'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_eligibility_api_clients_created_at" ON "eligibility_api_clients" ("created_at")`,
    );
  }
}
