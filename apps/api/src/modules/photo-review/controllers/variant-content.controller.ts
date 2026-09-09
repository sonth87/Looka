import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PhotoReviewService } from '../services/photo-review.service';

/**
 * Serves a `photo_variants` row's raw bytes straight from this API's own
 * Postgres (`variant_upload_outbox.content`) — the local-bytes fallback for
 * "not on fs-core yet", the variant counterpart of `capture`'s
 * `PhotoContentController` (see
 * `PhotoReviewService.resolveVariantViewSource`/`issueLocalVariantViewLink`).
 *
 * Deliberately its own controller, NOT a route on `ReviewController`: that
 * controller carries `@UseGuards(SsoAuthGuard, ReviewerRoleGuard)` at the
 * class level, applied to every route in it, but a browser `<img
 * src>`/`window.open(url)` never attaches an Authorization header — exactly
 * the same constraint `PhotoContentController` already documents for the
 * original-photo path. The URL itself carries a short-lived HMAC-signed
 * token (`exp`/`sig`, verified by
 * `PhotoReviewService.verifyLocalVariantViewTokenOrFail`) instead. A caller
 * still needs a valid, `ReviewerRoleGuard`-passing SSO session to ever MINT
 * one of these links in the first place (every `ReviewController` route that
 * returns a `PhotoVariantDao`/`ReviewSetListItemDao` is guarded); this route
 * only ever accepts a link one of those already handed out.
 */
@Controller({ path: 'review/variants', version: '1' })
@ApiTags('photo-review')
export class VariantContentController {
  constructor(private readonly photoReviewService: PhotoReviewService) {}

  @Get(':id/local-content')
  @ApiOperation({
    summary:
      "Stream a photo_variants row's bytes directly from Postgres — signed-link fallback for a variant not yet on the file-service",
  })
  async localContent(
    @Param('id') variantId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    this.photoReviewService.verifyLocalVariantViewTokenOrFail(variantId, exp, sig);
    const { data, mimeType } = await this.photoReviewService.readLocalVariantContent(variantId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    // `helmet()` (main.ts) sets `Cross-Origin-Resource-Policy: same-origin`
    // by default on every response, which silently blocks exactly the
    // `<img src>` load this route exists for once the CMS runs on a
    // different origin/port than this API (dev: 3200 vs 3100) — Chrome
    // fails it as `net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`, invisible
    // in a same-origin curl/Postman check, only surfaced by an actual
    // cross-origin browser load (confirmed live during this task's own CMS
    // verification). CORS is already deliberately open API-wide for this
    // exact cross-origin case (see main.ts's own comment); this header is
    // the other half of the same browser security model actually needs.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(data);
  }
}
