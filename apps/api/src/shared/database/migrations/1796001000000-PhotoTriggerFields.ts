import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auto-vs-manual capture statistics (§3.7/§3.7.1 of
 * docs/plans/campaign-config-sso-card-photo-discussion.md). `trigger_source`
 * is `@face/core`'s `CaptureTriggerSource` ('AUTO'|'GESTURE'|'SHUTTER'|
 * 'EXTERNAL') - what actually fired this particular shutter; `capture_mode`
 * is `@face/core`'s `CaptureTriggerMode` ('AUTO'|'MANUAL'|'OFF') - which
 * kiosk-wide setting was active when it did. Both nullable and CHECK-
 * constrained the same way `campaigns.capture_mode` already is
 * (`CHK_campaigns_capture_mode` in `CreateDeviceManagement1787500000000`):
 * absent for any photo whose path (older kiosk build, or the web path before
 * it started sending these) never reported one, but never garbage when
 * present.
 */
export class PhotoTriggerFields1796001000000 implements MigrationInterface {
  name = 'PhotoTriggerFields1796001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "photos"
        ADD COLUMN "trigger_source" character varying(20),
        ADD COLUMN "capture_mode" character varying(10)
    `);
    await queryRunner.query(`
      ALTER TABLE "photos"
        ADD CONSTRAINT "CHK_photos_trigger_source"
          CHECK ("trigger_source" IS NULL OR "trigger_source" IN ('AUTO', 'GESTURE', 'SHUTTER', 'EXTERNAL'))
    `);
    await queryRunner.query(`
      ALTER TABLE "photos"
        ADD CONSTRAINT "CHK_photos_capture_mode"
          CHECK ("capture_mode" IS NULL OR "capture_mode" IN ('AUTO', 'MANUAL', 'OFF'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "photos" DROP CONSTRAINT "CHK_photos_capture_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "photos" DROP CONSTRAINT "CHK_photos_trigger_source"`,
    );
    await queryRunner.query(`
      ALTER TABLE "photos"
        DROP COLUMN "trigger_source",
        DROP COLUMN "capture_mode"
    `);
  }
}
