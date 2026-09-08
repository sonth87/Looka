import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Secret rotation with overlap" + explicit "Thu hồi" (revoke) — 2026-09-08
 * fix for the "kiosk 3" incident (see docs/ROADMAP.md's dated entry): a
 * second `POST /v1/devices/:id/reissue` for an already-running kiosk used to
 * kill its live secret outright, with no way to undo it short of another
 * reissue. Six new nullable columns on `devices` (see `Device` entity's own
 * doc comments for what each one means) plus a new `REVOKED` status.
 */
export class DeviceSecretRotation1790000000000 implements MigrationInterface {
  name = 'DeviceSecretRotation1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "devices"
      ADD COLUMN "previous_secret_hash" character varying(64),
      ADD COLUMN "secret_rotated_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "last_auth_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "last_auth_failed_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "last_auth_fail_reason" character varying(20),
      ADD COLUMN "revoked_at" TIMESTAMP WITH TIME ZONE
    `);

    // Appended, not used in this same migration/transaction — see
    // 1789000000000-AttemptSuperseded.ts's identical note on why (safe with
    // the default `migrationsTransactionMode`).
    await queryRunner.query(
      `ALTER TYPE "devices_status_enum" ADD VALUE IF NOT EXISTS 'REVOKED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Same "rebuild rather than narrow" approach as AttemptSuperseded's
    // down() — but `devices.status` has `DEFAULT 'REGISTERED'`
    // (1787500000000-CreateDeviceManagement.ts), which Postgres refuses to
    // cast automatically across a type swap ("default cannot be cast
    // automatically to type ..."), so the default has to be dropped before
    // the column's type changes and restored after.
    await queryRunner.query(`ALTER TABLE "devices" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TYPE "devices_status_enum" RENAME TO "devices_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "devices_status_enum" AS ENUM ('REGISTERED', 'ACTIVATED')`,
    );
    await queryRunner.query(`
      ALTER TABLE "devices"
        ALTER COLUMN "status" TYPE "devices_status_enum"
        USING "status"::text::"devices_status_enum"
    `);
    await queryRunner.query(`ALTER TABLE "devices" ALTER COLUMN "status" SET DEFAULT 'REGISTERED'`);
    await queryRunner.query(`DROP TYPE "devices_status_enum_old"`);

    await queryRunner.query(`
      ALTER TABLE "devices"
      DROP COLUMN "previous_secret_hash",
      DROP COLUMN "secret_rotated_at",
      DROP COLUMN "last_auth_at",
      DROP COLUMN "last_auth_failed_at",
      DROP COLUMN "last_auth_fail_reason",
      DROP COLUMN "revoked_at"
    `);
  }
}
