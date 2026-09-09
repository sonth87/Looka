import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `devices.campaign_id` nullable + self-enroll columns (§3.3) — the FK also
 * changes from `ON DELETE CASCADE` to `ON DELETE SET NULL`: a campaign
 * delete detaching a self-enrolled device (which isn't really "that
 * campaign's" device) must not destroy the device row. Existing rows all
 * have a non-null `campaign_id` today (every device so far came through the
 * admin zip-registration path), so no data migration is needed — this only
 * relaxes the constraint for rows created going forward.
 */
export class DeviceSelfEnroll1793003000000 implements MigrationInterface {
  name = 'DeviceSelfEnroll1793003000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "devices" DROP CONSTRAINT "FK_devices_campaign"`);
    await queryRunner.query(`ALTER TABLE "devices" ALTER COLUMN "campaign_id" DROP NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "devices"
      ADD CONSTRAINT "FK_devices_campaign" FOREIGN KEY ("campaign_id")
        REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "devices"
      ADD COLUMN "hostname" character varying(255),
      ADD COLUMN "fingerprint" character varying(255),
      ADD COLUMN "enrolled_by_user_id" uuid,
      ADD COLUMN "last_user_id" uuid
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_devices_fingerprint" ON "devices" ("fingerprint")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_devices_fingerprint"`);
    await queryRunner.query(`
      ALTER TABLE "devices"
      DROP COLUMN "last_user_id",
      DROP COLUMN "enrolled_by_user_id",
      DROP COLUMN "fingerprint",
      DROP COLUMN "hostname"
    `);

    await queryRunner.query(`ALTER TABLE "devices" DROP CONSTRAINT "FK_devices_campaign"`);
    await queryRunner.query(`ALTER TABLE "devices" ALTER COLUMN "campaign_id" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "devices"
      ADD CONSTRAINT "FK_devices_campaign" FOREIGN KEY ("campaign_id")
        REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }
}
