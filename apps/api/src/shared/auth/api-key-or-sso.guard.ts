import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { SsoAuthGuard } from './sso-auth.guard';

/**
 * Gate for the "student gallery" read routes (`StudentController`) — the
 * only two routes in this API that must be reachable from both the CMS
 * (SSO Bearer only, no api-key in its bundle since the 2026-09-07 decision
 * to retire that shared secret from admin surfaces) and apps/web (api-key
 * only — no SSO concept exists there at all; see apps/web/src/App.tsx's
 * `window.LOOKA_API_KEY`).
 *
 * Deliberately scoped to just these two routes rather than reused more
 * broadly: it accepts the *existing* shared api-key (same `security.apiKey`
 * config `ApiKeyMiddleware` already enforces elsewhere) as an alternative to
 * SSO, which is a real widening of what that key can read. Spreading this
 * guard onto more routes would widen that surface further each time — see
 * docs/ROADMAP.md's 2026-09-08 "student gallery" entry for the full
 * reasoning on why `PhotoController`/`VideoController`'s own view-link
 * routes deliberately stay SSO-only instead of also taking this guard.
 *
 * Tries the api-key first (cheap, local, no network call) and only falls
 * back to a real SSO round trip when no key was sent — the common case for
 * both callers (apps/web always sends one; the CMS never does) resolves
 * without needing to try, fail, then fall back.
 */
@Injectable()
export class ApiKeyOrSsoGuard implements CanActivate {
  private readonly expectedKey: Buffer;

  constructor(
    configService: ConfigService,
    private readonly ssoAuthGuard: SsoAuthGuard,
  ) {
    const apiKey = configService.get<string>('security.apiKey');
    if (!apiKey) {
      throw new Error('API_KEY must be set - refusing to start without it');
    }
    this.expectedKey = Buffer.from(apiKey);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header('x-api-key');

    if (provided) {
      const providedKey = Buffer.from(provided);
      // Constant-time compare - same reasoning as ApiKeyMiddleware's
      // identical check: a length/byte-position-timed comparison would let
      // a caller recover the key one correct byte at a time.
      const valid =
        providedKey.length === this.expectedKey.length && timingSafeEqual(providedKey, this.expectedKey);
      if (valid) return true;
      // A wrong key falls through to the SSO check rather than rejecting
      // immediately - harmless (the SSO check will reject too, absent a
      // valid Authorization header) and avoids treating a caller that sent
      // both an expired key and a fresh SSO token as locked out.
    }

    return this.ssoAuthGuard.canActivate(context);
  }
}
