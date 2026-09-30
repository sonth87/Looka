import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CampaignSnapshotService } from './campaign-snapshot.service';

/**
 * Real-Postgres spec for `CampaignSnapshotService.refresh` — skipped when
 * TEST_DATABASE_URL is absent, same gate as the other `*-live.spec.ts` files.
 * Added 2026-09-30 after a dashboard browser test found
 * `stats_campaign_snapshot.printed` was hard-coded to 0 and never updated, so
 * the dashboard's "Đã in" tile (`GET /v1/dashboard/kpis`) could never move.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('CampaignSnapshotService.refresh (live)', () => {
  let dataSource: DataSource;
  let service: CampaignSnapshotService;
  const campaignIds: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url });
    await dataSource.initialize();
    service = new CampaignSnapshotService(dataSource);
  });

  afterAll(async () => {
    if (campaignIds.length) {
      await dataSource.query(
        `DELETE FROM print_items WHERE campaign_id = ANY($1)`,
        [campaignIds],
      );
      await dataSource.query(
        `DELETE FROM stats_campaign_snapshot WHERE campaign_id = ANY($1)`,
        [campaignIds],
      );
      await dataSource.query(`DELETE FROM campaigns WHERE id = ANY($1)`, [
        campaignIds,
      ]);
    }
    await dataSource.destroy();
  });

  const addItem = (campaignId: string, code: string, status: string) =>
    dataSource.query(
      `INSERT INTO print_items (campaign_id, set_id, subject_code, status) VALUES ($1, gen_random_uuid(), $2, $3)`,
      [campaignId, code, status],
    );

  const printedOf = async (campaignId: string): Promise<number> => {
    const rows: Array<{ printed: number }> = await dataSource.query(
      `SELECT printed FROM stats_campaign_snapshot WHERE campaign_id = $1`,
      [campaignId],
    );
    return rows[0].printed;
  };

  it('counts each PRINTED student once (a reprint row does not double-count), ignores non-PRINTED items, and updates on a second refresh', async () => {
    const campaignId = randomUUID();
    campaignIds.push(campaignId);
    await dataSource.query(
      `INSERT INTO campaigns (id, name) VALUES ($1, 'zz snapshot-printed test')`,
      [campaignId],
    );
    await addItem(campaignId, 'ZZSNAP-A', 'PRINTED');
    await addItem(campaignId, 'ZZSNAP-A', 'PRINTED'); // reprint of the same student
    await addItem(campaignId, 'ZZSNAP-B', 'PRINTED');
    await addItem(campaignId, 'ZZSNAP-C', 'PENDING');
    await addItem(campaignId, 'ZZSNAP-D', 'EXPORTED');

    await service.refresh([campaignId]);
    expect(await printedOf(campaignId)).toBe(2);

    // The ON CONFLICT path must update the column too, not only the first INSERT.
    await dataSource.query(
      `UPDATE print_items SET status = 'PRINTED' WHERE campaign_id = $1 AND subject_code = 'ZZSNAP-D'`,
      [campaignId],
    );
    await service.refresh([campaignId]);
    expect(await printedOf(campaignId)).toBe(3);
  });
});
