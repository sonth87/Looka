import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CampaignKioskAssignmentDao, CampaignKioskSummaryDao } from '../dao';
import { AssignCampaignKioskDto } from '../dto/assign-campaign-kiosk.dto';
import { CampaignKioskAssignmentService } from '../services/campaign-kiosk-assignment.service';

/**
 * "1 người ↔ 1 kiosk" — cms-8-screens-api-plan.md §2.3/D-Q4. Reuses
 * `campaign:write` (no new permission code) — assigning a kiosk is
 * campaign administration, same bucket create/update/delete already sit in.
 */
@Controller({ path: 'campaigns', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class CampaignKioskAssignmentController {
  constructor(
    private readonly assignmentService: CampaignKioskAssignmentService,
  ) {}

  @Get(':id/assignments')
  @ApiOperation({ summary: 'List a campaign’s kiosk↔person assignments' })
  @ApiResponseArrayDecorator(CampaignKioskAssignmentDao)
  listAssignments(
    @Param('id') campaignId: string,
  ): Promise<CampaignKioskAssignmentDao[]> {
    return this.assignmentService.listAssignments(campaignId);
  }

  /** cms-8-screens-api-plan.md §2.1 dashboard detail — kiosks under this campaign + who's assigned. */
  @Get(':id/kiosks')
  @ApiOperation({
    summary:
      'List kiosks set up for this campaign, with assignee + session count',
  })
  @ApiResponseArrayDecorator(CampaignKioskSummaryDao)
  listKiosks(
    @Param('id') campaignId: string,
  ): Promise<CampaignKioskSummaryDao[]> {
    return this.assignmentService.listKiosksForCampaign(campaignId);
  }

  @Put(':id/assignments/:deviceId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('campaign:write', 'Gán người vào kiosk')
  @ApiOperation({
    summary:
      'Assign (or replace) the person assigned to a kiosk — auto-approves their campaign membership',
  })
  @ApiResponseDecorator(CampaignKioskAssignmentDao)
  assign(
    @Param('id') campaignId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: AssignCampaignKioskDto,
    @Req() req: Request,
  ): Promise<CampaignKioskAssignmentDao> {
    return this.assignmentService.assign(
      campaignId,
      deviceId,
      dto,
      req.user?.id ?? null,
    );
  }

  @Delete(':id/assignments/:deviceId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('campaign:write', 'Bỏ gán kiosk')
  @ApiOperation({ summary: 'Remove a kiosk assignment' })
  async unassign(
    @Param('id') campaignId: string,
    @Param('deviceId') deviceId: string,
  ): Promise<{ campaignId: string; deviceId: string }> {
    await this.assignmentService.unassign(campaignId, deviceId);
    return { campaignId, deviceId };
  }
}
