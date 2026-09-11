import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { toDao } from '@app/shared/http/to-dao.helper';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CampaignConfigDao } from '../dao/campaign-config.dao';
import { CampaignMemberGuard } from '../guards/campaign-member.guard';
import { CampaignService } from '../services/campaign.service';

/**
 * `GET /v1/campaigns/:id/config` (§3.1.4/§3.2.2) — the user-token
 * counterpart to the kiosk's `GET /v1/devices/config`, resolved directly
 * from `:id` rather than a device's `campaign_id` (devices no longer
 * necessarily have one — self-enroll, §3.3). Gated by `CampaignMemberGuard`
 * (stacked after `SsoAuthGuard`): the caller must be an APPROVED member of
 * an OPEN campaign, or the guard refuses with a machine-readable `reason`
 * before this handler ever runs. Never touches device activation state —
 * this is a user-token endpoint, unrelated to `DeviceService.verifyCredentials`.
 */
@Controller({ path: 'campaigns', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard, CampaignMemberGuard)
@ApiBearerAuth('sso')
export class CampaignConfigController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get(':id/config')
  @ApiOperation({
    summary:
      "Get a campaign's capture config for an approved member — same shape as the kiosk's GET /v1/devices/config, minus captureMode/autoHoldMs/simultaneousCapture",
  })
  @ApiResponseDecorator(CampaignConfigDao)
  async getCampaignConfig(@Param('id') id: string): Promise<CampaignConfigDao> {
    const campaign = await this.campaignService.findCampaignEntityOrFail(id);
    const fullDao = await this.campaignService.toCampaignResponse(campaign);
    return toDao(CampaignConfigDao, fullDao);
  }
}
