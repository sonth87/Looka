import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CampaignSubjectLookupDao } from '../dao';
import { DeviceCredentialsGuard } from '../guards/device-credentials.guard';
import { CampaignSubjectService } from '../services/campaign-subject.service';

/**
 * `GET /v1/campaigns/:id/subjects/lookup?key=` — the kiosk-facing
 * counterpart of `CampaignSubjectController` (§2.3's kiosk note, replaces
 * the desktop's local `response.json` roster read, D-Q3). Kept as its own
 * controller, `DeviceCredentialsGuard`-only, same "different caller"
 * convention `DeviceSelfController` already uses — a kiosk has a device
 * identity, never the SSO/permission stack the CMS routes need.
 */
@Controller({ path: 'campaigns', version: '1' })
@ApiTags('device-management')
@UseGuards(DeviceCredentialsGuard)
export class CampaignSubjectLookupController {
  constructor(private readonly subjectService: CampaignSubjectService) {}

  @Get(':id/subjects/lookup')
  @ApiOperation({
    summary:
      'Kiosk roster lookup by subjectCode or citizenId — ROSTER-mode only, see the service’s own doc comment for what is deferred',
  })
  @ApiResponseDecorator(CampaignSubjectLookupDao)
  lookup(
    @Param('id') campaignId: string,
    @Query('key') key: string,
    @Req() req: Request,
  ): Promise<CampaignSubjectLookupDao> {
    // A kiosk may only look up subjects under its own campaign — same
    // nullable/ownership guard `DeviceSelfController`'s routes already
    // enforce for `campaignId`.
    if (req.device!.campaignId !== campaignId) {
      throw new CustomException(
        'This device is not registered under the requested campaign',
        ERROR_CODE.DEVICE_CAMPAIGN_MISMATCH,
        HttpStatus.CONFLICT,
      );
    }
    return this.subjectService.lookupSubject(campaignId, key);
  }
}
