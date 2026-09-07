import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
   */
  @Post(':id/view-link')
  @ApiOperation({
    summary: 'Issue a short-lived link the browser can load directly',
  })
  async viewLink(
    @Param('id') photoId: string,
    @Body() dto: ViewLinkDto,
  ): Promise<PhotoViewLink> {
    const { fsFileId, tenantName } =
      await this.photoService.resolveViewContext(photoId);
    return this.fileStorage.issueViewLink(
      fsFileId,
      dto.viewerId ?? 'web-viewer',
      tenantName,
    );
  }
}
