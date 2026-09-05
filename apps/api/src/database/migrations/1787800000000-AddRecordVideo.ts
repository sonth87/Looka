import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `record_video` to `campaigns` — see
 * docs/plans/multi-camera-device-management-discussion.md §3.1 and the
 * entity's own doc comment. Campaign-level only, same reasoning as
 * `simultaneous_capture` (1787700000000-AddSimultaneousCapture): a device
 * inherits it through `campaign_id`, never its own column.
 */
export class AddRecordVideo1787800000000 implements MigrationInterface {
  name = 'AddRecordVideo1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN "record_video" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN "record_video"
    `);
  }
}
