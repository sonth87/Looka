import {
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/common/decorators';
import { SsoAuthGuard } from '@app/common/guards';
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
}
