import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '@app/common/guards';
import {
  FileStorageService,
  PhotoViewLink,
} from '@app/modules/file-storage/services/file-storage.service';
import { ViewLinkDto } from '../dto';
import { SessionVideoService } from '../services/session-video.service';

/**
 * Mirrors `PhotoController` exactly — CMS-only (`SessionDetailDrawer`), so
 * SsoAuthGuard rather than the kiosk/web capture path's shared `x-api-key`;
 * see that controller's own doc comment.
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

  @Post(':id/view-link')
  @ApiOperation({
    summary: 'Issue a short-lived link the browser can load directly',
  })
  async viewLink(
    @Param('id') videoId: string,
    @Body() dto: ViewLinkDto,
  ): Promise<PhotoViewLink> {
    const { fsFileId, tenantName } =
      await this.sessionVideoService.resolveViewContext(videoId);
    return this.fileStorage.issueViewLink(
      fsFileId,
      dto.viewerId ?? 'web-viewer',
      tenantName,
    );
  }
}
