import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  FileStorageService,
  PhotoViewLink,
} from '@app/modules/file-storage/services/file-storage.service';
import { ViewLinkDto } from '../dto';
import { PhotoService } from '../services/photo.service';

@Controller({ path: 'photos', version: '1' })
@ApiTags('capture')
@ApiSecurity('apiKey')
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
    const fileId = await this.photoService.findFsFileIdOrFail(photoId);
    return this.fileStorage.issueViewLink(fileId, dto.viewerId ?? 'web-viewer');
  }
}
