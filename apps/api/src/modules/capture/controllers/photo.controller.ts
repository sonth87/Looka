import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  FileStorageService,
  PhotoViewLink,
} from '@app/modules/file-storage/services/file-storage.service';
import { ViewLinkDto } from '../dto';
import { PhotoService } from '../services/photo.service';

/**
 * `viewLink` is called directly by the CMS (SessionDetailDrawer, to render a
 * photo thumbnail) - confirmed apps/web's kiosk flow never calls this route
 * itself, so unlike SessionController this whole controller moved off the
 * shared `x-api-key` to `SsoAuthGuard` as part of the 2026-09-07 decision to
 * retire api-key from CMS/admin surfaces.
 *
 * No `@RequirePermission` here on purpose, not an oversight — `apps/cms/src/
 * api.ts`'s `issuePhotoViewLink` doc comment names this as an explicit
 * product decision ("Phase 11 plan", decision 3): "every signed-in SSO
 * operator may open full-size photos". A 2026-09-24 review flagged the
 * absence of a permission gate here as a bug (any first-time, zero-role SSO
 * login can open any student's photo, since every capture is stored
 * `visibility: 'public'` on fs-core — see `PhotoService.addPhoto`'s own
 * comment) — left AS IS specifically because narrowing it would reverse that
 * documented product decision, which is not this fix's call to make; the
 * part of that finding that WAS a genuine bug (the viewer identity fs-core
 * records being spoofable) is fixed below.
 */
@Controller({ path: 'photos', version: '1' })
@ApiTags('capture')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class PhotoController {
  constructor(
    private readonly photoService: PhotoService,
    private readonly fileStorage: FileStorageService,
  ) {}

  /**
   * Hand the browser a link it can load directly, without the API key going
   * with it. The viewer identity fs-core records (audit trail, and any
   * future watermark) is the SSO-authenticated caller's own id (`req.user`,
   * attached by `SsoAuthGuard`) — 2026-09-24 fix: this used to be
   * `dto.viewerId`, taken straight from the request body, so any caller
   * could name someone else's id and have the download attributed to them
   * instead. See `ViewLinkDto`'s own doc comment.
   *
   * Falls back to this API's own locally held bytes
   * (`PhotoContentController`'s `GET :id/local-content`, unauthenticated but
   * signed) when the photo has not reached fs-core yet — Part A of the
   * capture-routing work ("a captured photo that hasn't reached the file
   * server yet must still be shown to the user"). The real fs-core link is
   * still preferred once `fs_file_id` lands; see
   * `PhotoService.resolveViewSource`'s own doc comment.
   */
  @Post(':id/view-link')
  @ApiOperation({
    summary: 'Issue a short-lived link the browser can load directly',
  })
  async viewLink(
    @Req() req: Request,
    @Param('id') photoId: string,
    @Body() _dto: ViewLinkDto,
  ): Promise<PhotoViewLink> {
    const source = await this.photoService.resolveViewSource(photoId);
    if (source.kind === 'remote') {
      return this.fileStorage.issueViewLink(
        source.fsFileId,
        req.user!.id,
        source.tenantName,
      );
    }

    // The origin the calling browser actually used to reach this request —
    // not a configured public URL — so the returned link resolves correctly
    // whether the CMS/kiosk reached this API via localhost or a LAN address.
    const apiBaseUrl = `${req.protocol}://${req.get('host')}`;
    return this.photoService.issueLocalViewLink(photoId, apiBaseUrl);
  }
}
