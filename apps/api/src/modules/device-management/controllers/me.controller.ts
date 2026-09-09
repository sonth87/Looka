import { ApiResponseArrayDecorator } from '@app/common/decorators';
import { SsoAuthGuard, type AuthenticatedUser } from '@app/common/guards';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { MeCampaignDao } from '../dao/me.dao';
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
  constructor(private readonly campaignMemberService: CampaignMemberService) {}

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
}
