import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SessionVideoService } from '../services/session-video.service';

/**
 * Serves a video's raw bytes straight from this API's own Postgres
 * (`video_upload_outbox.content`) — the local-bytes fallback for "not on
 * fs-core yet" (2026-09-09, "route kiosk VIDEO uploads through apps/api"),
 * the exact video counterpart of `PhotoContentController`; see that
 * controller's own doc comment for why this is deliberately NOT behind
 * `SsoAuthGuard` and why `Cross-Origin-Resource-Policy` is set explicitly.
 */
@Controller({ path: 'videos', version: '1' })
@ApiTags('capture')
export class VideoContentController {
  constructor(private readonly sessionVideoService: SessionVideoService) {}

  @Get(':id/local-content')
  @ApiOperation({
    summary:
      "Stream a video's bytes directly from Postgres — signed-link fallback for a video not yet on the file-service",
  })
  async localContent(
    @Param('id') videoId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    this.sessionVideoService.verifyLocalViewTokenOrFail(videoId, exp, sig);
    const { data, mimeType } = await this.sessionVideoService.readLocalContent(videoId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(data);
  }
}
