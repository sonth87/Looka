/**
 * `viewerId` (2026-09-24 removed) used to be taken straight from this
 * request body and forwarded to fs-core as the X-Viewer-ID / share-token
 * principal fs-core records as the audit/watermark identity at redeem time
 * (download/link.go + download/service.go) — any caller could name someone
 * else's id here and have the download attributed to them. The controller
 * now derives the viewer from `req.user.id` (the SSO-authenticated caller),
 * which cannot be spoofed through the body, so there is nothing left for
 * this DTO to carry. Kept as an empty class rather than deleted outright:
 * both controllers still declare `@Body() dto: ViewLinkDto` and a POST with
 * a JSON body needs a DTO type for `@Body()` to validate against — an empty
 * body, or one still sending the old `viewerId` field (silently stripped by
 * the global `whitelist: true` ValidationPipe), both validate fine.
 */
export class ViewLinkDto {}
