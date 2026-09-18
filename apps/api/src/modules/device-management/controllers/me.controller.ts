import { ApiResponseArrayDecorator } from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard, type AuthenticatedUser } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { MeCampaignDao } from '../dao/me.dao';
import { CampaignMemberService } from '../services/campaign-member.service';

/**
 * The logged-in user's own view — §3.2.2. `getMe` needs nothing beyond
 * `SsoAuthGuard`: any authenticated person can see their own profile.
 *
 * `getMyCampaigns` additionally gained `PermissionsGuard` +
 * `campaign:read` (2026-09-14, assignment pivot): the self-join/browse
 * model ("see every non-closed campaign, self-register") is being retired
 * in favor of admin-assigns-you. Non-admins now need `campaign:read`
 * granted AND an `APPROVED` `campaign_members` row per campaign
 * (`CampaignMemberService.listCampaignsForUser`'s own filter) to see
 * anything back; admins bypass both (`PermissionsGuard`'s `isAdmin`
 * fast-path, and `listCampaignsForUser(userId, true)` skipping the filter).
 * `campaign_members` is granted either by self-join + admin approval
 * (`CampaignMemberController.joinCampaign`/`decideMember`) or the CMS's
 * bulk "Cấp quyền" (`CampaignMemberController.grantMembers`) — see
 * `CampaignMemberService.grant()`'s own doc comment.
 *
 * `getMyAssignments` (`GET /v1/me/assignments`, D-Q17 — "which kiosk(s) am
 * I assigned to") was removed 2026-09-18 alongside the whole
 * `campaign_kiosk_assignments` table: nothing on the kiosk/desktop side
 * ever called it (confirmed by a repo-wide search before removal), and a
 * kiosk no longer needs to ask this at all — any campaign member can use
 * any device already registered under that campaign; a session's own
 * `device_id`/`operator_user_id` come from the kiosk's device credentials
 * and its locally-logged-in operator, independent of any pairing.
 */
@Controller({ path: 'me', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class MeController {
  constructor(private readonly campaignMemberService: CampaignMemberService) {}

  @Get()
  @ApiOperation({
    summary: "Get the calling user's own profile (as attached by SsoAuthGuard)",
  })
  getMe(@Req() req: Request): AuthenticatedUser {
    return req.user!;
  }

  @Get('campaigns')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    'campaign:read',
    'Xem & thao tác đợt chụp được giao (kiosk)',
  )
  @ApiOperation({
    summary:
      "List campaigns visible to the caller: admins see every campaign not manually CLOSED; everyone else sees only campaigns they're APPROVED for, each with effectiveStatus/quotaReached and the caller's own membership status",
  })
  @ApiResponseArrayDecorator(MeCampaignDao)
  getMyCampaigns(@Req() req: Request): Promise<MeCampaignDao[]> {
    return this.campaignMemberService.listCampaignsForUser(
      req.user!.id,
      req.user!.isAdmin,
    );
  }
}
