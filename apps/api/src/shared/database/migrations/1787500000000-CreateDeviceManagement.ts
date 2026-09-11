import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * campaigns/devices schema for docs/plans/multi-camera-device-management-discussion.md
 * §3.2. `expires_at`, `consent_content`, `capture_angles`, `capture_mode`
 * all live on `campaigns` only — a device inherits them through
 * `campaign_id`, never its own column, per that doc's campaign-level
 * decision (renewing/editing a campaign must affect every device under it
 * at once, with nothing to update per-device).
 */
export class CreateDeviceManagement1787500000000 implements MigrationInterface {
  name = 'CreateDeviceManagement1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "campaigns_purpose_enum" AS ENUM ('STUDENT_CARD', 'KYC_ENROLLMENT')`,
    );
    await queryRunner.query(`
      CREATE TABLE "campaigns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(255) NOT NULL,
        "description" text,
        "purpose" "campaigns_purpose_enum" NOT NULL DEFAULT 'STUDENT_CARD',
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "consent_content" text,
        "consent_version" integer NOT NULL DEFAULT 0,
        "capture_angles" jsonb,
        "capture_mode" character varying(10),
        "auto_hold_ms" integer,
        CONSTRAINT "PK_campaigns" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_campaigns_capture_mode"
          CHECK ("capture_mode" IS NULL OR "capture_mode" IN ('AUTO', 'MANUAL', 'OFF'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_created_at" ON "campaigns" ("created_at")`,
    );

    await queryRunner.query(
      `CREATE TYPE "devices_status_enum" AS ENUM ('REGISTERED', 'ACTIVATED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "devices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "auth_api_endpoint" character varying(500),
        "device_secret_hash" character varying(64) NOT NULL,
        "status" "devices_status_enum" NOT NULL DEFAULT 'REGISTERED',
        "activated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_devices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_devices_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_devices_created_at" ON "devices" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_devices_campaign_id" ON "devices" ("campaign_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "devices"`);
    await queryRunner.query(`DROP TYPE "devices_status_enum"`);
    await queryRunner.query(`DROP TABLE "campaigns"`);
    await queryRunner.query(`DROP TYPE "campaigns_purpose_enum"`);
  }
}
