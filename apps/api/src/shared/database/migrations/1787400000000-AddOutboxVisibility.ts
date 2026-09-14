import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Visibility for the file-service upload, decided at capture time.
 *
 * Nullable, no default: this is a decision for the code that knows what is
 * being captured, not something this migration should bake in as a column
 * default. NULL means "let the file-service apply its own default."
 *
 * `PhotoService.addPhoto` originally wrote 'private' here for every card
 * photo, reasoning it as biometric data — reverted to 'public' 2026-09-14
 * once integration testing against fs-core's real source showed
 * file-service's owner-based read ACL denies ANY non-owner read of a
 * private file, and Looka's file-service client never sends
 * `X-Owner-User-Id` (pure API-key auth leaves `owner_user_id` null
 * server-side). A private photo captured through this path was therefore
 * permanently unreadable via `issueViewLink` — see `PhotoService.addPhoto`'s
 * own comment for the full reasoning.
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
