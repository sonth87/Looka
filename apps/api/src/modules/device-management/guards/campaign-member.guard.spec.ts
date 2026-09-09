import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CampaignMemberGuard } from './campaign-member.guard';
import { CampaignMemberService } from '../services/campaign-member.service';
import { CampaignService } from '../services/campaign.service';

function contextWithReq(
  req: Partial<{ params: Record<string, string>; user: unknown }>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params: {}, ...req }),
    }),
  } as unknown as ExecutionContext;
}

describe('CampaignMemberGuard', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');
  const openCampaign = {
    id: 'c1',
    manualStatus: null,
    startsAt: null,
    expiresAt: null,
  };
  const upcomingCampaign = {
    id: 'c2',
    manualStatus: null,
    startsAt: new Date('2099-01-01T00:00:00.000Z'),
    expiresAt: null,
  };

  let campaignService: { findCampaignEntityOrFail: jest.Mock };
  let campaignMemberService: { findMembership: jest.Mock };
  let guard: CampaignMemberGuard;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    campaignService = { findCampaignEntityOrFail: jest.fn() };
    campaignMemberService = { findMembership: jest.fn() };
    guard = new CampaignMemberGuard(
      campaignService as unknown as CampaignService,
      campaignMemberService as unknown as CampaignMemberService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('allows an APPROVED member of an OPEN campaign', async () => {
    campaignService.findCampaignEntityOrFail.mockResolvedValue(openCampaign);
    campaignMemberService.findMembership.mockResolvedValue({
      status: 'APPROVED',
    });

    const req = { params: { id: 'c1' }, user: { id: 'u1' } };
    await expect(guard.canActivate(contextWithReq(req))).resolves.toBe(true);
  });

  test('refuses with reason CAMPAIGN_NOT_OPEN when the campaign is not OPEN, even for an approved member', async () => {
    campaignService.findCampaignEntityOrFail.mockResolvedValue(
      upcomingCampaign,
    );
    campaignMemberService.findMembership.mockResolvedValue({
      status: 'APPROVED',
    });

    const req = { params: { id: 'c2' }, user: { id: 'u1' } };
    try {
      await guard.canActivate(contextWithReq(req));
      fail('expected ForbiddenException');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse() as Record<
        string,
        unknown
      >;
      expect(response.reason).toBe('CAMPAIGN_NOT_OPEN');
      expect(response.effectiveStatus).toBe('UPCOMING');
    }
    // Membership must never even be looked up once the status check fails -
    // effectiveStatus is checked first (guard's own doc comment).
    expect(campaignMemberService.findMembership).not.toHaveBeenCalled();
  });

  test('refuses with reason NOT_APPROVED when the campaign is open but there is no membership row at all', async () => {
    campaignService.findCampaignEntityOrFail.mockResolvedValue(openCampaign);
    campaignMemberService.findMembership.mockResolvedValue(null);

    const req = { params: { id: 'c1' }, user: { id: 'u1' } };
    try {
      await guard.canActivate(contextWithReq(req));
      fail('expected ForbiddenException');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse() as Record<
        string,
        unknown
      >;
      expect(response.reason).toBe('NOT_APPROVED');
      expect(response.membershipStatus).toBe('NONE');
    }
  });

  test('refuses with reason NOT_APPROVED and the real status when membership is PENDING', async () => {
    campaignService.findCampaignEntityOrFail.mockResolvedValue(openCampaign);
    campaignMemberService.findMembership.mockResolvedValue({
      status: 'PENDING',
    });

    const req = { params: { id: 'c1' }, user: { id: 'u1' } };
    try {
      await guard.canActivate(contextWithReq(req));
      fail('expected ForbiddenException');
    } catch (error) {
      const response = (error as ForbiddenException).getResponse() as Record<
        string,
        unknown
      >;
      expect(response.reason).toBe('NOT_APPROVED');
      expect(response.membershipStatus).toBe('PENDING');
    }
  });

  test('reads the campaign id from :campaignId when :id is absent', async () => {
    campaignService.findCampaignEntityOrFail.mockResolvedValue(openCampaign);
    campaignMemberService.findMembership.mockResolvedValue({
      status: 'APPROVED',
    });

    const req = { params: { campaignId: 'c1' }, user: { id: 'u1' } };
    await expect(guard.canActivate(contextWithReq(req))).resolves.toBe(true);
    expect(campaignService.findCampaignEntityOrFail).toHaveBeenCalledWith('c1');
  });

  test('refuses when req.user is missing (guard used without SsoAuthGuard in front of it)', async () => {
    const req = { params: { id: 'c1' } };
    await expect(guard.canActivate(contextWithReq(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(campaignService.findCampaignEntityOrFail).not.toHaveBeenCalled();
  });
});
