import { ApiResponseArrayDecorator } from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard, type AuthenticatedUser } from '@app/shared/auth/index';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CampaignKioskAssignmentDao } from '../dao';
import { MeCampaignDao } from '../dao/me.dao';
import { CampaignKioskAssignmentService } from '../services/campaign-kiosk-assignment.service';
import { CampaignMemberService } from '../services/campaign-member.service';

/**
 * The logged-in user's own view — §3.2.2. Both routes need nothing beyond
 * `SsoAuthGuard`: any authenticated person can see their own profile and
 * the list of campaigns they could join/are in, regardless of admin status.
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
  @ApiOperation({
    summary:
      "List every campaign not manually CLOSED, each with effectiveStatus/quotaReached and the caller's own membership status",
  })
  @ApiResponseArrayDecorator(MeCampaignDao)
  getMyCampaigns(@Req() req: Request): Promise<MeCampaignDao[]> {
    return this.campaignMemberService.listCampaignsForUser(req.user!.id);
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
