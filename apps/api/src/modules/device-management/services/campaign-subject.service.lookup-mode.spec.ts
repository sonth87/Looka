import { CampaignSubjectService } from './campaign-subject.service';

/**
 * `lookupSubject`'s mode resolution — 2026-09-18, `eligibility` moved off
 * the pinned workflow onto the campaign's own `eligibilityConfig` column
 * (see `Campaign.eligibilityConfig`'s own doc comment and the
 * `CampaignEligibilityConfig1831000000000` migration's doc comment for the
 * full rationale). Locks in the one deliberate behavior clarification that
 * move made: a campaign with NOTHING configured (`eligibilityConfig: null`
 * or `{ mode: 'NONE' }`, the column default) is eligible unconditionally
 * and never even queries the roster — it no longer silently falls back to
 * `ROSTER` mode the way `lookupSubject` used to before mode-awareness
 * existed. ROSTER/EXTERNAL_API/ROSTER_AND_API branch behavior itself is
 * covered by `campaign-subject.service.eligibility.spec.ts`.
 */
function buildService(campaignService: {
  findCampaignEntityOrFail: jest.Mock;
}) {
  const repository = { findOne: jest.fn() };
  const eligibilityLogRepository = {
    create: jest.fn((x: unknown) => x),
    save: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new CampaignSubjectService(
      repository as never,
      undefined as never,
      eligibilityLogRepository as never,
      undefined as never,
      campaignService as never,
      undefined as never,
      undefined as never,
      undefined as never,
    ),
    repository,
  };
}

describe('CampaignSubjectService.lookupSubject — mode resolution (2026-09-18 campaign migration)', () => {
  it('eligibilityConfig: null → mode defaults to NONE, eligible unconditionally, no roster query', async () => {
    const campaignService = {
      findCampaignEntityOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'campaign-1', eligibilityConfig: null }),
    };
    const { service, repository } = buildService(campaignService);

    const result = await service.lookupSubject('campaign-1', 'SV001');

    expect(result.eligible).toBe(true);
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('eligibilityConfig: { mode: "NONE" } (the column default) → eligible unconditionally', async () => {
    const campaignService = {
      findCampaignEntityOrFail: jest.fn().mockResolvedValue({
        id: 'campaign-1',
        eligibilityConfig: { mode: 'NONE' },
      }),
    };
    const { service, repository } = buildService(campaignService);

    const result = await service.lookupSubject('campaign-1', 'SV001');

    expect(result.eligible).toBe(true);
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('eligibilityConfig: { mode: "ROSTER" } → does query the roster (regression guard against silently going back to NONE-only)', async () => {
    const campaignService = {
      findCampaignEntityOrFail: jest.fn().mockResolvedValue({
        id: 'campaign-1',
        eligibilityConfig: { mode: 'ROSTER' },
      }),
    };
    const { service, repository } = buildService(campaignService);
    repository.findOne.mockResolvedValue(null);

    const result = await service.lookupSubject('campaign-1', 'SV999');

    expect(repository.findOne).toHaveBeenCalled();
    expect(result.eligible).toBe(false);
  });
});
