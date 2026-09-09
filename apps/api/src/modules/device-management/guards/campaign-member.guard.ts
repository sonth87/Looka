import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { CampaignMemberService } from '../services/campaign-member.service';
import { CampaignService } from '../services/campaign.service';
import { computeEffectiveStatus } from '../utils/campaign-status.util';

/**
 * Gate for `GET /v1/campaigns/:id/config` (§3.2.2/§3.2.3) — meant to be
 * stacked AFTER `SsoAuthGuard` (`@UseGuards(SsoAuthGuard, CampaignMemberGuard)`),
 * same convention as `AdminRoleGuard`. Reads the campaign id from whichever
 * route param the route it's applied to actually uses (`:id` or
 * `:campaignId` — checked in that order since every current route using
 * this guard names the param `:id`).
 *
 * Refuses with a `ForbiddenException` whose body carries a machine-readable
 * `reason` (`CAMPAIGN_NOT_OPEN` vs `NOT_APPROVED`) — the UI needs to tell
 * these two apart (task brief): "campaign chưa mở/hết hạn/tạm dừng, quay
 * lại sau" reads very differently from "gửi yêu cầu tham gia trước". The
 * `effectiveStatus`/`membershipStatus` values ride along too so the client
 * doesn't need a second round trip to know *why*.
 *
 * Effective-status is checked first: even an already-APPROVED member can't
 * fetch a campaign's config while it's UPCOMING/EXPIRED/PAUSED/CLOSED — an
 * approval never expires the "campaign must actually be open" requirement.
 */
@Injectable()
export class CampaignMemberGuard implements CanActivate {
  constructor(
    private readonly campaignService: CampaignService,
    private readonly campaignMemberService: CampaignMemberService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const rawCampaignId = req.params.id ?? req.params.campaignId;
    const campaignId = Array.isArray(rawCampaignId)
      ? rawCampaignId[0]
      : rawCampaignId;

    if (!campaignId) {
      throw new ForbiddenException({
        message: 'Campaign id is missing from the route',
        reason: 'CAMPAIGN_ID_MISSING',
      });
    }
    if (!req.user) {
      // Should be unreachable when stacked correctly after SsoAuthGuard —
      // fail closed rather than crash on `req.user.id` below.
      throw new ForbiddenException({
        message: 'Not authenticated',
        reason: 'NOT_AUTHENTICATED',
      });
    }

    const campaign =
      await this.campaignService.findCampaignEntityOrFail(campaignId);
    const effectiveStatus = computeEffectiveStatus(campaign);
    if (effectiveStatus !== 'OPEN') {
      throw new ForbiddenException({
        message: `Campaign is not open (${effectiveStatus})`,
        reason: 'CAMPAIGN_NOT_OPEN',
        effectiveStatus,
      });
    }

    const membership = await this.campaignMemberService.findMembership(
      campaignId,
      req.user.id,
    );
    if (!membership || membership.status !== 'APPROVED') {
      throw new ForbiddenException({
        message: 'You have not been approved for this campaign yet',
        reason: 'NOT_APPROVED',
        membershipStatus: membership?.status ?? 'NONE',
      });
    }

    return true;
  }
}
