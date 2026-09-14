import { ApiResponseArrayDecorator } from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard, type AuthenticatedUser } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CampaignKioskAssignmentDao } from '../dao';
import { MeCampaignDao } from '../dao/me.dao';
import { CampaignKioskAssignmentService } from '../services/campaign-kiosk-assignment.service';
import { CampaignMemberService } from '../services/campaign-member.service';

/**
 * The logged-in user's own view — §3.2.2. `getMe`/`getMyAssignments` need
 * nothing beyond `SsoAuthGuard`: any authenticated person can see their own
 * profile and their own kiosk assignments, regardless of admin status.
 *
 * `getMyCampaigns` additionally gained `PermissionsGuard` +
 * `campaign:read` (2026-09-14, assignment pivot): the self-join/browse
 * model ("see every non-closed campaign, self-register") is being retired
 * in favor of admin-assigns-you. Non-admins now need `campaign:read`
 * granted AND an `APPROVED` `campaign_members` row per campaign
 * (`CampaignMemberService.listCampaignsForUser`'s own filter) to see
 * anything back; admins bypass both (`PermissionsGuard`'s `isAdmin`
 * fast-path, and `listCampaignsForUser(userId, true)` skipping the filter).
 */
@Controller({ path: 'me', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class MeController {
  constructor(
    private readonly campaignMemberService: CampaignMemberService,
    private readonly assignmentService: CampaignKioskAssignmentService,
  ) {}

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

  /** D-Q17 — which kiosk(s) the caller is assigned to, optionally scoped to one campaign. */
  @Get('assignments')
  @ApiOperation({
    summary: 'List the kiosk(s) assigned to the calling user',
  })
  @ApiResponseArrayDecorator(CampaignKioskAssignmentDao)
  getMyAssignments(
    @Req() req: Request,
    @Query('campaignId') campaignId?: string,
  ): Promise<CampaignKioskAssignmentDao[]> {
    return this.assignmentService.listForUser(req.user!.id, campaignId);
  }
}
