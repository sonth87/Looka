import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P6-Giai đoạn 5 — `13-features-and-2-blockers-plan-2026-09-18.md` §5.2
 * (feature 13: chia việc duyệt ảnh theo nhóm). `review_assignments` is a
 * dynamic 3-column grant `(user_id, group_field, group_value)` — global,
 * not per-campaign (no `campaign_id`, matching the plan's own column list).
 * `group_field` is restricted by application-level validation (DTO
 * `@IsIn`) to `SubjectPhotoSet`'s 3 denormalized roster columns
 * (`className`/`faculty`/`major`) — no DB CHECK constraint, so a future
 * group field can be added without another migration, same reasoning as
 * this module's other free-text-from-roster columns.
 *
 * `user_id` has no FK — this module's consistent "never FK a user-id
 * column" convention (e.g. `photo_variants.created_by_user_id`).
 *
 * Unique on `(user_id, group_field, group_value)` — re-granting the same
 * group to the same person is a harmless no-op, not a new row.
 */
export class ReviewAssignments1835000000000 implements MigrationInterface {
  name = 'ReviewAssignments1835000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "review_assignments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "user_id" uuid NOT NULL,
        "group_field" character varying(20) NOT NULL,
        "group_value" character varying(255) NOT NULL,
        "created_by_user_id" uuid,
        CONSTRAINT "PK_review_assignments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_review_assignments_user_field_value" ON "review_assignments" ("user_id", "group_field", "group_value")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_review_assignments_user_id" ON "review_assignments" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "review_assignments"`);
  }
}
