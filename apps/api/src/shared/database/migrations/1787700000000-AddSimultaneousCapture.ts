import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `simultaneous_capture` to `campaigns` — see
 * docs/plans/multi-camera-device-management-discussion.md and the entity's
 * own doc comment. Like `capture_angles`/`capture_mode` (§3.2 via
 * 1787500000000-CreateDeviceManagement), this is campaign-level only: a
 * device inherits it through `campaign_id`, never its own column.
 */
export class AddSimultaneousCapture1787700000000 implements MigrationInterface {
  name = 'AddSimultaneousCapture1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN "simultaneous_capture" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN "simultaneous_capture"
    `);
  }
}
