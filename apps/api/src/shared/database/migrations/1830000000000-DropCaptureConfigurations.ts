import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `capture_configurations` ("Mẫu chụp", migration
 * `1801000000000-CaptureConfigurations.ts`) — the follow-up migration
 * `1814000000000-CampaignWorkflowRef.ts` already one-time-copied every row
 * here into `workflows`/`workflow_versions` (version 1, `ACTIVE`), so no
 * data is lost by dropping the source table now.
 *
 * This is the actual table-drop the plan called for
 * (`1814000000000-CampaignWorkflowRef.ts`'s own doc comment: "the table
 * itself is NOT dropped here … dropping it is a follow-up once the CMS
 * switches to `/v1/workflows`") — the CMS switch is this same task
 * (2026-09-17, user correction: "workflow và mẫu chụp đang có nhiều trường
 * thông tin giống nhau … chỉ config 1 lần"), which retires
 * `CampaignForm.tsx`'s separate "Mẫu chụp" picker in favor of picking a
 * Workflow directly — see that component's own doc comment.
 *
 * `down()` recreates the original table shape (same DDL as
 * `1801000000000-CaptureConfigurations.ts`'s `up()`) but, like that
 * migration's sibling `1829000000000-DropEligibilityApiClients.ts`, does
 * not attempt to reverse the 1814 data copy — a rollback gets an empty
 * table back, not the original rows.
 */
export class DropCaptureConfigurations1830000000000 implements MigrationInterface {
  name = 'DropCaptureConfigurations1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "capture_configurations"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "capture_configurations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(255) NOT NULL,
        "description" text,
        "capture_angles" jsonb NOT NULL,
        "card_spec" jsonb,
        CONSTRAINT "PK_capture_configurations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_capture_configurations_created_at" ON "capture_configurations" ("created_at")`,
    );
  }
}
