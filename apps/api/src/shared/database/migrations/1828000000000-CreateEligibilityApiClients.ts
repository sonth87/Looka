import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generalizes "điều kiện tiếp nhận" API config (plan item 7, 2026-09-17)
 * from exactly one hardcoded TS class (`DainamStudentInfoClient`,
 * `EligibilityCatalogService`'s own literal 1-row array) into a DB catalog
 * an admin manages from the CMS — enter the endpoint/auth/credential, test
 * call it, and `eligibility.api.clientCode` in a workflow's config now
 * references a row here instead of a compiled-in literal.
 *
 * Seeds `DAINAM_STUDENT_INFO` with the same `base_url`/`request_path`
 * `student-directory.adapter.ts` already hardcodes, so existing workflows
 * referencing that `clientCode` keep resolving to the same endpoint with no
 * config change needed. Deliberately does NOT migrate the real
 * `DAINAM_STUDENT_INFO_API_KEY` value out of `.env` into this table — that
 * would mean handling a live production credential inside a migration
 * script (which ends up in migration history/logs); `credential_ciphertext`
 * is seeded NULL, so an admin must re-enter that key once via the new CMS
 * screen before this client can call out for real (a one-time manual step,
 * called out in the plan's own §5).
 */
export class CreateEligibilityApiClients1828000000000 implements MigrationInterface {
  name = 'CreateEligibilityApiClients1828000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

    await queryRunner.query(`
      INSERT INTO "eligibility_api_clients"
        ("code", "name", "base_url", "request_method", "request_path", "request_body_template", "auth_type", "auth_param_name", "key_response_path") VALUES
        ('DAINAM_STUDENT_INFO', 'API sinh viên Đại Nam (openapi.dainam.edu.vn)',
          'https://openapi.dainam.edu.vn', 'POST', '/api/get_list_student_info',
          '{"student_code": "{{key}}", "faculty_id": 0, "traning_system_id": 0, "course_year": 0}'::jsonb,
          'API_KEY_HEADER', 'x-api-key', 'data[0].student_code')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "eligibility_api_clients"`);
  }
}
