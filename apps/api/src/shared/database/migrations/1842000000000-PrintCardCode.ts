import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Mã thẻ" (card code) for the CENTRALIZED print export/import flow.
 *
 * The print shop fills the card code into the returned result xlsx (a new
 * optional `Mã thẻ` column, see `PrintResultImportService`); the system stores
 * it per card and shows it in the CMS.
 *
 * 1. `print_items.card_code` — the code of THIS specific printed card. Nullable
 *    (the column is optional in the xlsx, and every item that predates this
 *    migration has no code). No unique index on purpose — whether a card code
 *    must be unique (per campaign? globally?) is an open business question.
 *
 * 2. `campaign_subjects.card_code` — "the card code of the latest card printed
 *    for this student", written in the same transaction (and by the same UPDATE
 *    statements) that already stamp `printed_at`/`printed_batch_id`, so the
 *    (printed_batch_id, card_code) pair always describes the same card. No FK
 *    or shared type across modules — same "no cross-module FK" convention as
 *    `printed_batch_id` itself (`1818000000000-Print.ts` top comment).
 *
 * Both are `varchar(64)`; the import rejects (never truncates) a longer value.
 */
export class PrintCardCode1842000000000 implements MigrationInterface {
  name = 'PrintCardCode1842000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "print_items"
        ADD COLUMN "card_code" character varying(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "campaign_subjects"
        ADD COLUMN "card_code" character varying(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaign_subjects"
        DROP COLUMN "card_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "print_items"
        DROP COLUMN "card_code"
    `);
  }
}
