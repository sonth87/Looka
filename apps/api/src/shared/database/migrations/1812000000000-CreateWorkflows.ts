import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Nghiệp vụ" (business process) — cms-8-screens-api-plan.md §2.2/P2. Two
 * tables, immutable-version pattern (same architecture precedent
 * `docs/KE-HOACH-DU-AN.md` §11.5 already sketched for this codebase):
 *
 * - `workflows`: the named process (`code` unique, e.g. `STUDENT_CARD`),
 *   `status` DRAFT (never published) | ACTIVE (published at least once,
 *   `current_version_id` resolvable) | ARCHIVED (no longer selectable for
 *   NEW campaigns; existing campaigns already pinned to a version keep
 *   working). `current_version_id` has no FK to `workflow_versions` —
 *   same bare-uuid cross-table reference convention `subject_photo_sets.
 *   current_card_variant_id` already uses, since the two tables are
 *   created in the same migration but the relationship is 1:1-at-a-time,
 *   not enforced at the DB level.
 * - `workflow_versions`: one row per published-or-being-drafted version.
 *   `published_at IS NULL` = still a draft, config editable; NOT NULL =
 *   frozen forever (application layer refuses to update it — see
 *   `WorkflowVersion.updateConfig()`'s own doc comment). `config` holds
 *   the full 6-group jsonb (`domain/schema/workflow-config.schema.ts`
 *   validates its shape with zod before anything is written here).
 */
export class CreateWorkflows1812000000000 implements MigrationInterface {
  name = 'CreateWorkflows1812000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "workflows" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(50) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "status" character varying(10) NOT NULL DEFAULT 'DRAFT',
        "current_version_id" uuid,
        "created_by_user_id" uuid,
        CONSTRAINT "PK_workflows" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workflows_code" UNIQUE ("code"),
        CONSTRAINT "CHK_workflows_status" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workflows_created_at" ON "workflows" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workflows_status" ON "workflows" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "workflow_versions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workflow_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "config" jsonb NOT NULL,
        "published_at" TIMESTAMP WITH TIME ZONE,
        "published_by_user_id" uuid,
        "note" text,
        CONSTRAINT "PK_workflow_versions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workflow_versions_workflow_version" UNIQUE ("workflow_id", "version"),
        CONSTRAINT "FK_workflow_versions_workflow" FOREIGN KEY ("workflow_id")
          REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workflow_versions_workflow_id" ON "workflow_versions" ("workflow_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "workflow_versions"`);
    await queryRunner.query(`DROP TABLE "workflows"`);
  }
}
