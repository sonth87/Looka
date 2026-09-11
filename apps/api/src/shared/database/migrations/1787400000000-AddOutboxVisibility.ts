import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Visibility for the file-service upload, decided at capture time.
 *
 * Nullable, no default: 'private' is what `PhotoService.addPhoto` writes for
 * every card photo today, but that is a decision for the code that knows
 * what is being captured - not something this migration should bake in as a
 * column default, which would make a future non-biometric use of this same
 * outbox silently private too. NULL means "let the file-service apply its
 * own default."
 */
export class AddOutboxVisibility1787400000000 implements MigrationInterface {
  name = 'AddOutboxVisibility1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "upload_outbox"
        ADD COLUMN "visibility" character varying(10)
    `);
    await queryRunner.query(`
      ALTER TABLE "upload_outbox"
        ADD CONSTRAINT "CHK_upload_outbox_visibility"
        CHECK ("visibility" IS NULL OR "visibility" IN ('public', 'private'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "upload_outbox" DROP CONSTRAINT "CHK_upload_outbox_visibility"`,
    );
    await queryRunner.query(
      `ALTER TABLE "upload_outbox" DROP COLUMN "visibility"`,
    );
  }
}
