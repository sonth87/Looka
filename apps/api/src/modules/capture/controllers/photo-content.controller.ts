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
    // `helmet()` (main.ts) sets `Cross-Origin-Resource-Policy: same-origin`
    // by default on every response, which silently blocks exactly the
    // `<img src>` load this route exists for once the CMS runs on a
    // different origin/port than this API (dev: 3200 vs 3100) — Chrome
    // fails it as `net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`, invisible in
    // a same-origin curl/Postman check, only surfaced by an actual
    // cross-origin browser load (confirmed live via the photo-review
    // module's identical local-content route during this task's own CMS
    // verification — see `VariantContentController`'s own copy of this
    // comment). CORS is already deliberately open API-wide for this exact
    // cross-origin case (see main.ts's own comment); this header is the
    // other half of the same browser security model actually needs.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(data);
  }
}
