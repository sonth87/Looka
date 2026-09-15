import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { PhotoReviewService } from '@app/modules/photo-review/services/photo-review.service';
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CampaignSubjectPhotoStatusDao } from '../dao/campaign-subject-photo-status.dao';
import { CampaignMemberGuard } from '../guards/campaign-member.guard';

/**
 * `GET /v1/campaigns/:id/subjects/:subjectCode/photo-status` (2026-09-15) —
 * the kiosk's pre-capture "đã có hồ sơ ảnh chưa?" check (field request: an
 * operator re-scanning a student who was already photographed this campaign
 * should be warned and shown the existing photo before starting a brand-new
 * session, instead of silently recapturing over it). Called by
 * `FaceCaptureApp.tsx`'s `handleLookupResult`, right after a student-code/
 * CCCD lookup resolves FOUND, before the greeting/session-start flow.
 *
 * Same `SsoAuthGuard, CampaignMemberGuard` stack as `CampaignConfigController`
 * (admin bypass, APPROVED-member-of-an-OPEN-campaign check) — the same
 * operators who can already start a capture session for this campaign can
 * check this, nothing new to authorize. Deliberately NOT
 * `ReviewerRoleGuard` (`GET /v1/review/sets`'s own guard): a kiosk operator
 * has no reason to hold the CMS reviewer role just to see "this student
 * already has a photo" before recapturing.
 *
 * Read-only and side-effect-free — see `PhotoReviewService.
 * findExistingSetForSubject`'s own doc comment for why that matters here
 * (safe to call before every single lookup, not just once).
 */
@Controller({ path: 'campaigns', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard, CampaignMemberGuard)
@ApiBearerAuth('sso')
export class CampaignSubjectPhotoStatusController {
  constructor(private readonly photoReviewService: PhotoReviewService) {}

  private apiBaseUrl(req: Request): string {
    return `${req.protocol}://${req.get('host')}`;
  }

  @Get(':id/subjects/:subjectCode/photo-status')
  @ApiOperation({
    summary:
      'Whether this subject already has a photo-review set in this campaign, and a preview URL if so',
  })
  @ApiResponseDecorator(CampaignSubjectPhotoStatusDao)
  async getPhotoStatus(
    @Param('id') campaignId: string,
    @Param('subjectCode') subjectCode: string,
    @Req() req: Request,
  ): Promise<CampaignSubjectPhotoStatusDao> {
    const result = await this.photoReviewService.findExistingSetForSubject(
      campaignId,
      subjectCode,
      this.apiBaseUrl(req),
    );
    const dao = new CampaignSubjectPhotoStatusDao();
    dao.exists = result.exists;
    dao.status = result.status;
    dao.capturedAt = result.capturedAt;
    dao.viewUrl = result.viewUrl;
    return dao;
  }
}
