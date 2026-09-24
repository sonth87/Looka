import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  FileStorageService,
  PhotoViewLink,
} from '@app/modules/file-storage/services/file-storage.service';
import { ViewLinkDto } from '../dto';
import { SessionVideoService } from '../services/session-video.service';

/**
 * Mirrors `PhotoController` — CMS-only (`SessionDetailDrawer`), so
 * SsoAuthGuard rather than the kiosk/web capture path's shared `x-api-key`;
 * see that controller's own doc comment, including why it deliberately has
 * no `@RequirePermission` (a documented product decision, not an oversight)
 * and its 2026-09-24 viewer-identity fix, both applied identically here.
 */
@Controller({ path: 'videos', version: '1' })
@ApiTags('capture')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class VideoController {
  constructor(
    private readonly sessionVideoService: SessionVideoService,
    private readonly fileStorage: FileStorageService,
  ) {}

  /**
   * Hand the browser a link it can load directly — as of 2026-09-09 ("route
   * kiosk VIDEO uploads through apps/api"), with exactly the same
   * remote-vs-local branch `PhotoController.viewLink` already has: falls
   * back to this API's own locally held bytes
   * (`VideoContentController`'s `GET :id/local-content`, unauthenticated but
   * signed) whenever the remote fs-core copy is not healthy — not on
   * fs-core yet, purged mid-scan, or stuck in a non-terminal scan state past
   * `SessionVideoService.SCAN_STALE_MS` — instead of the previous
   * "resolveViewContext or throw GONE" behaviour, which left the CMS with no
   * way to show a video at all once fs-core lost it.
   *
   * Viewer identity is `req.user.id`, not a client-supplied `viewerId` — see
   * `PhotoController.viewLink`'s identical 2026-09-24 fix and
   * `ViewLinkDto`'s own doc comment.
   */
  @Post(':id/view-link')
  @ApiOperation({
    summary: 'Issue a short-lived link the browser can load directly',
  })
  async viewLink(
    @Req() req: Request,
    @Param('id') videoId: string,
    @Body() _dto: ViewLinkDto,
  ): Promise<PhotoViewLink> {
    const source = await this.sessionVideoService.resolveViewSource(videoId);
    if (source.kind === 'remote') {
      return this.fileStorage.issueViewLink(
        source.fsFileId,
        req.user!.id,
        source.tenantName,
      );
    }

    // The origin the calling browser actually used to reach this request —
    // see PhotoController.viewLink's identical comment.
    const apiBaseUrl = `${req.protocol}://${req.get('host')}`;
    return this.sessionVideoService.issueLocalViewLink(videoId, apiBaseUrl);
  }
}
