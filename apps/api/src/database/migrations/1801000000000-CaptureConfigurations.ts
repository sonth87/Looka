import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Capture Configuration" table (item 10, 2026-09-09 task brief) — a
 * reusable capture template an admin manages independently of any one
 * campaign. See `CaptureConfiguration` entity's own doc comment: this is a
 * one-time-copy preset for `CampaignForm.tsx`'s "Chọn từ cấu hình có sẵn",
 * never a live foreign key a campaign reads from at runtime — no
 * relationship column to any other table exists here on purpose.
 */
export class CaptureConfigurations1801000000000
  implements MigrationInterface
{
  name = 'CaptureConfigurations1801000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "capture_configurations"`);
  }
}
