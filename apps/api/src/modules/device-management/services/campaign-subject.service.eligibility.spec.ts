import { CampaignSubjectService } from './campaign-subject.service';
import { EligibilityRule } from '../util/eligibility-rule.evaluator';

/**
 * Plan §E.2/§E.3 (`upload-identity-and-workflow-cleanup-plan-2026-09-17.md`):
 * - `lookupSubject`'s ROSTER branch used to ignore `eligibility.rules[]`
 *   entirely — found-in-roster-with-VALID-status was always eligible, no
 *   matter what rules a campaign's CMS editor configured. These tests lock
 *   in the fix (rule pass/fail) AND the regression guarantee (no rules
 *   configured → unchanged old behavior).
 * - `testRosterLookup` is the new dry-run method backing the
 *   campaign-editing screen's "Kiểm tra theo dữ liệu đã import" button.
 * - 2026-09-18: `eligibility` moved off the pinned workflow onto the
 *   campaign's own `eligibilityConfig` column — these tests now set it
 *   directly on the fake campaign returned by `findCampaignEntityOrFail`
 *   instead of mocking a `workflowCatalog.getVersionRef` lookup.
 *
 * Fakes stay plain object shapes cast with `as never` at the constructor
 * call site, same convention `campaign-subject.service.import-roster.spec.ts`
 * already uses.
 */
function buildService(
  overrides: {
    repository?: { findOne: jest.Mock };
    eligibilityLogRepository?: { create: jest.Mock; save: jest.Mock };
    campaignService?: { findCampaignEntityOrFail: jest.Mock };
  } = {},
) {
  const repository = overrides.repository ?? { findOne: jest.fn() };
  const eligibilityLogRepository = overrides.eligibilityLogRepository ?? {
    create: jest.fn((x: unknown) => x),
    save: jest.fn().mockResolvedValue(undefined),
  };
  // Default: plain ROSTER mode, no rules — this whole spec file is about
  // the ROSTER branch specifically (the real architectural default when
  // NOTHING is configured is 'NONE', covered by
  // campaign-subject.service.lookup-mode.spec.ts instead).
  const campaignService = overrides.campaignService ?? {
    findCampaignEntityOrFail: jest.fn().mockResolvedValue({
      id: 'campaign-1',
      eligibilityConfig: { mode: 'ROSTER' },
    }),
  };

  return new CampaignSubjectService(
    repository as never,
    undefined as never,
    eligibilityLogRepository as never,
    undefined as never,
    campaignService as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

const ROSTER_ROW = {
  id: 'subject-1',
  campaignId: 'campaign-1',
  subjectCode: 'SV001',
  fullName: 'Nguyễn Văn A',
  citizenId: '001199000111',
  className: 'CNTT1',
  faculty: 'CNTT',
  major: 'KTPM',
  status: 'VALID',
};

function passingRule(): EligibilityRule {
  return {
    key: 'class-check',
    expr: 'className == "CNTT1"',
    message: 'Không đúng lớp cho phép',
  };
}

function failingRule(): EligibilityRule {
  return {
    key: 'class-check',
    expr: 'className == "KHONG-TON-TAI"',
    message: 'Không đúng lớp cho phép',
  };
}

function campaignWithEligibility(eligibilityConfig: unknown) {
  return {
    findCampaignEntityOrFail: jest
      .fn()
      .mockResolvedValue({ id: 'campaign-1', eligibilityConfig }),
  };
}

describe('CampaignSubjectService.lookupSubject — ROSTER mode now evaluates rules[] (plan §E.2)', () => {
  it('a passing rule keeps the subject eligible', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(ROSTER_ROW) };
    const service = buildService({
      repository,
      campaignService: campaignWithEligibility({
        mode: 'ROSTER',
        rules: [passingRule()],
      }),
    });

    const result = await service.lookupSubject('campaign-1', 'SV001');

    expect(result.eligible).toBe(true);
    expect(result.subject?.subjectCode).toBe('SV001');
  });

  it('a failing rule makes the subject ineligible, with the rule’s own message as reason', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(ROSTER_ROW) };
    const service = buildService({
      repository,
      campaignService: campaignWithEligibility({
        mode: 'ROSTER',
        rules: [failingRule()],
      }),
    });

    const result = await service.lookupSubject('campaign-1', 'SV001');

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('Không đúng lớp cho phép');
  });

  it('regression: no rules configured → found-in-roster is eligible, full stop', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(ROSTER_ROW) };
    const service = buildService({ repository });

    const result = await service.lookupSubject('campaign-1', 'SV001');

    expect(result.eligible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('regression: ROSTER mode but rules is an explicit empty array → found-in-roster is still eligible, full stop', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(ROSTER_ROW) };
    const service = buildService({
      repository,
      campaignService: campaignWithEligibility({ mode: 'ROSTER', rules: [] }),
    });

    const result = await service.lookupSubject('campaign-1', 'SV001');

    expect(result.eligible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('not found in roster → ineligible regardless of rules', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(null) };
    const service = buildService({ repository });

    const result = await service.lookupSubject('campaign-1', 'SV999');

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('Không tìm thấy trong danh sách đợt này');
  });
});

describe('CampaignSubjectService.testRosterLookup — dry-run for the campaign editor (plan §E.3)', () => {
  it('key not found in roster → found:false, eligible:false', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(null) };
    const service = buildService({ repository });

    const result = await service.testRosterLookup('campaign-1', 'SV999', []);

    expect(result.found).toBe(false);
    expect(result.subject).toBeNull();
    expect(result.eligible).toBe(false);
  });

  it('found, no rules sent → found:true, eligible:true', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(ROSTER_ROW) };
    const service = buildService({ repository });

    const result = await service.testRosterLookup('campaign-1', 'SV001', []);

    expect(result.found).toBe(true);
    expect(result.eligible).toBe(true);
    expect(result.subject?.subjectCode).toBe('SV001');
  });

  it('found, a draft rule fails → found:true, eligible:false, reason + context surfaced', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(ROSTER_ROW) };
    const service = buildService({ repository });

    const result = await service.testRosterLookup('campaign-1', 'SV001', [
      failingRule(),
    ]);

    expect(result.found).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('Không đúng lớp cho phép');
    expect(result.context).toMatchObject({ className: 'CNTT1' });
  });

  it('never writes eligibility_check_logs (dry-run, not a real kiosk lookup)', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(ROSTER_ROW) };
    const eligibilityLogRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const service = buildService({ repository, eligibilityLogRepository });

    await service.testRosterLookup('campaign-1', 'SV001', [passingRule()]);

    expect(eligibilityLogRepository.create).not.toHaveBeenCalled();
    expect(eligibilityLogRepository.save).not.toHaveBeenCalled();
  });
});
