import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CampaignMemberDao } from '../dao';
import { DecideCampaignMemberDto } from '../dto/decide-campaign-member.dto';
import { GrantCampaignMembersDto } from '../dto/grant-campaign-members.dto';
import { ListCampaignMembersQueryDto } from '../dto/list-campaign-members-query.dto';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { CampaignMemberService } from '../services/campaign-member.service';

/**
 * Per-campaign approval routes (§2.3/§3.2.2) — `join` is any logged-in
 * user; `members`/decide are CTSV-on-CMS only (`AdminRoleGuard`). Kept as
 * its own controller (same split-by-caller convention as
 * `DeviceController`/`DeviceSelfController`) rather than folded into
 * `CampaignController`, since `join` and the admin-only routes below it
 * have deliberately different guard stacks on the very same `campaigns/:id`
 * path prefix.
 */
@Controller({ path: 'campaigns', version: '1' })
@ApiTags('device-management')
@ApiBearerAuth('sso')
export class CampaignMemberController {
  constructor(private readonly campaignMemberService: CampaignMemberService) {}

  @Post(':id/join')
  @UseGuards(SsoAuthGuard)
  @ApiOperation({
    summary:
      'Request to join a campaign — idempotent, returns the existing membership unchanged if one already exists',
  })
  @ApiResponseDecorator(CampaignMemberDao, { status: 201 })
  joinCampaign(
    @Param('id') campaignId: string,
    @Req() req: Request,
  ): Promise<CampaignMemberDao> {
    return this.campaignMemberService.joinCampaign(campaignId, req.user!.id);
  }

  @Get(':id/members')
  @UseGuards(SsoAuthGuard, AdminRoleGuard)
  @ApiOperation({
    summary: "List a campaign's members, paginated, filterable by status",
  })
  @ApiResponsePaginatedDecorator(CampaignMemberDao)
  listMembers(
    @Param('id') campaignId: string,
    @Query() query: ListCampaignMembersQueryDto,
  ) {
    return this.campaignMemberService.listMembers(campaignId, query);
  }

  @Patch(':id/members/:userId')
  @UseGuards(SsoAuthGuard, AdminRoleGuard)
  @ApiOperation({ summary: 'Approve, reject, or revoke a campaign membership' })
  @ApiResponseDecorator(CampaignMemberDao)
  decideMember(
    @Param('id') campaignId: string,
    @Param('userId') userId: string,
    @Body() dto: DecideCampaignMemberDto,
    @Req() req: Request,
  ): Promise<CampaignMemberDao> {
    return this.campaignMemberService.decide(
      campaignId,
      userId,
      dto,
      req.user!.id,
    );
  }

  /**
   * `POST /v1/campaigns/:id/members/grant` (2026-09-18) — bulk one-step
   * "cấp quyền" from the CMS's campaign-list page, replacing the deleted
   * `campaign_kiosk_assignments` auto-approve shortcut. See
   * `CampaignMemberService.grant()`'s own doc comment.
   */
  @Post(':id/members/grant')
  @UseGuards(SsoAuthGuard, AdminRoleGuard)
  @ApiOperation({
    summary:
      'Grant APPROVED campaign membership to a batch of users in one call',
  })
  @ApiResponseArrayDecorator(CampaignMemberDao)
  grantMembers(
    @Param('id') campaignId: string,
    @Body() dto: GrantCampaignMembersDto,
    @Req() req: Request,
  ): Promise<CampaignMemberDao[]> {
    return this.campaignMemberService.grant(campaignId, dto, req.user!.id);
  }
}
