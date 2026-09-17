import { BadRequestException } from '@nestjs/common';
import { CampaignSubjectService } from './campaign-subject.service';

/**
 * `distinctValues()` — card-photo-export-and-filters-plan-2026-09-17.md
 * §G.2.a. `field` never reaches the raw SQL string unless it first survives
 * the hardcoded `DISTINCT_VALUE_COLUMNS` allowlist lookup — these tests lock
 * in that the query sent to Postgres is the one that dedupes (`DISTINCT`),
 * excludes null/empty (`IS NOT NULL AND ... <> ''`) and sorts (`ORDER BY`)
 * for each of the 3 allowed fields, and that an invalid `field` is rejected
 * BEFORE any SQL is even built — same fake-constructor convention
 * `campaign-subject.service.import-roster.spec.ts` already uses (plain
 * object fakes, cast to `never` only at the `new CampaignSubjectService(...)`
 * call site).
 */
function buildService(dataSource: { query: jest.Mock }) {
  const campaignService = {
    findCampaignEntityOrFail: jest.fn().mockResolvedValue({ id: 'campaign-1' }),
  };
  return {
    service: new CampaignSubjectService(
      {} as never, // repository — unused by distinctValues
      {} as never, // importRepository
      undefined as never, // eligibilityLogRepository
      dataSource as never,
      campaignService as never,
      {} as never, // fileStorage
      {} as never, // snapshotService
      undefined as never, // workflowCatalog
      undefined as never, // eligibilityHttpClient
    ),
    campaignService,
  };
}

function fakeDataSource(rows: Array<{ value: string }>) {
  return { query: jest.fn().mockResolvedValue(rows) };
}

describe('CampaignSubjectService.distinctValues (plan §G.2.a)', () => {
  it.each([
    ['className', 'class_name'],
    ['faculty', 'faculty'],
    ['major', 'major'],
  ] as const)(
    'field=%s: queries the allowlisted column %s, deduped/null-excluded/sorted, scoped to the campaign',
    async (field, column) => {
      const dataSource = fakeDataSource([{ value: 'A' }, { value: 'B' }]);
      const { service, campaignService } = buildService(dataSource);

      const result = await service.distinctValues('campaign-1', field);

      expect(campaignService.findCampaignEntityOrFail).toHaveBeenCalledWith(
        'campaign-1',
      );
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain(`SELECT DISTINCT ${column} AS value`);
      expect(sql).toContain('FROM campaign_subjects');
      expect(sql).toContain('WHERE campaign_id = $1');
      expect(sql).toContain(`${column} IS NOT NULL`);
      expect(sql).toContain(`${column} <> ''`);
      expect(sql).toContain(`ORDER BY ${column}`);
      expect(params).toEqual(['campaign-1']);
      expect(result.items).toEqual(['A', 'B']);
    },
  );

  it('maps query rows straight through to items, in the order Postgres returned them', async () => {
    const dataSource = fakeDataSource([
      { value: 'Khoa CNTT' },
      { value: 'Khoa Điện' },
    ]);
    const { service } = buildService(dataSource);

    const result = await service.distinctValues('campaign-1', 'faculty');

    expect(result.items).toEqual(['Khoa CNTT', 'Khoa Điện']);
  });

  it('rejects an invalid field before building any SQL (allowlist, not raw interpolation)', async () => {
    const dataSource = fakeDataSource([]);
    const { service } = buildService(dataSource);

    await expect(
      service.distinctValues(
        'campaign-1',
        'subjectCode; DROP TABLE campaign_subjects;' as never,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
