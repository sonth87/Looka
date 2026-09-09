import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SsoAuthGuard } from '@app/common/guards';
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
   * with it. `viewerId` is who the file-service will check permission against
   * when the link is opened - in a deployment with real sign-in it comes from
   * the session, not from the request body.
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
    @Body() dto: ViewLinkDto,
  ): Promise<PhotoViewLink> {
    const source = await this.photoService.resolveViewSource(photoId);
    if (source.kind === 'remote') {
      return this.fileStorage.issueViewLink(
        source.fsFileId,
        dto.viewerId ?? 'web-viewer',
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
