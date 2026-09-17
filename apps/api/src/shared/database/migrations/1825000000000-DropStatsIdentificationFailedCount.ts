import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `stats_daily_identification.failed_count` (`StatsModule1816000000000`)
 * — confirmed dead in the 2026-09-16 database audit
 * (docs/audits/danh-gia-database-2026-09-16.md §7.1): `CaptureStatsService`
 * never increments it (only `applyDeviceEvent`'s `count` counter is written
 * on the hot path), and `identificationStats()` never selects it. Unlike
 * `campaign_subjects.extra` (kept — see that entity's own doc comment,
 * E1.1's `extra jsonb` catch-all convention), nothing here suggests this
 * column was deliberately built ahead of a planned reader; it is simply
 * unused.
 */
export class DropStatsIdentificationFailedCount1825000000000 implements MigrationInterface {
  name = 'DropStatsIdentificationFailedCount1825000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stats_daily_identification" DROP COLUMN "failed_count"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stats_daily_identification"
      ADD COLUMN "failed_count" integer NOT NULL DEFAULT 0
    `);
  }
}
