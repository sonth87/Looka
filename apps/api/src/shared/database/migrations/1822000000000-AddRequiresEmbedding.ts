import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `requires_embedding` to `campaigns` — campaign-level switch for
 * whether captured photos get sent to the external face-embedding server on
 * CCCD-scan identification (previously always-on, unconditionally, for
 * every campaign). Default `true` so every existing campaign keeps its
 * current always-on behaviour unless an admin explicitly opts it out —
 * deliberately the opposite default of `record_video`
 * (1787800000000-AddRecordVideo), which was always opt-in.
 */
export class AddRequiresEmbedding1822000000000 implements MigrationInterface {
  name = 'AddRequiresEmbedding1822000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN "requires_embedding" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN "requires_embedding"
    `);
  }
}
