import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PhotoService } from '../services/photo.service';

/**
 * Serves a photo's raw bytes straight from this API's own Postgres
 * (`upload_outbox.content`) — the local-bytes fallback for "not on fs-core
 * yet" (Part A of the "route kiosk photo uploads through apps/api" work;
 * see `PhotoService.resolveViewSource`/`issueLocalViewLink`).
 *
 * Deliberately NOT behind `SsoAuthGuard` (unlike `PhotoController`, which
 * this sits next to): a browser loading `<img src>`/`window.open(url)`
 * never attaches an Authorization header, exactly the same constraint a
 * real fs-core view-link already has to work under. The URL itself carries
 * a short-lived HMAC-signed token (`exp`/`sig`, verified by
 * `PhotoService.verifyLocalViewTokenOrFail`) instead — the same
 * "unguessable, self-expiring, no separate auth header" property fs-core's
 * own link has. A caller still needs a valid SSO session to ever MINT one
 * of these links in the first place (`PhotoController.viewLink` is guarded);
 * this route only ever accepts a link that guard already handed out.
 */
@Controller({ path: 'photos', version: '1' })
@ApiTags('capture')
export class PhotoContentController {
  constructor(private readonly photoService: PhotoService) {}

  @Get(':id/local-content')
  @ApiOperation({
    summary:
      "Stream a photo's bytes directly from Postgres — signed-link fallback for a photo not yet on the file-service",
  })
  async localContent(
    @Param('id') photoId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    this.photoService.verifyLocalViewTokenOrFail(photoId, exp, sig);
    const { data, mimeType } = await this.photoService.readLocalContent(photoId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(data);
  }
}
