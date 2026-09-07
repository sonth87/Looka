import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Gate for the CMS/admin surface (campaigns, devices, and the CMS-facing
 * session-browsing routes) — replaces the shared admin `x-api-key`
 * (`ApiKeyMiddleware`) there per the 2026-09-07 product decision to stop
 * using it once SSO login shipped in the CMS (see docs/ROADMAP.md).
 *
 * Validates the caller by forwarding its own `Authorization`/`x-refresh-token`
 * headers to the external SSO backend's `GET <SSO_BASE_URL>/auth/profile`,
 * exactly the header-based auth path docs/LOGIN.md §12 describes for a
 * consuming app on a different domain than the SSO backend (this CMS's
 * shape). A request is accepted only when that call succeeds (HTTP 2xx) and
 * the JSON body has `authenticated === true`.
 *
 * Nothing is cached across requests: LOGIN.md §12.3 already describes
 * header-based validation as not requiring a Redis-backed session, so this
 * guard mirrors that statelessness — every request re-checks with the SSO
 * backend rather than trusting a previous answer. That costs a network round
 * trip per request but means a revoked SSO session stops working immediately
 * everywhere, not just after some local cache expires.
 *
 * `ApiKeyMiddleware` itself is untouched by this guard and keeps gating the
 * genuine capture-pipeline routes apps/web's unattended kiosk calls.
 *
 * Fail-closed by design: "xóa api-key" means the old credential is gone, not
 * that these routes become open when misconfigured. If `SSO_BASE_URL` is
 * unset, every request is rejected — the same posture `ApiKeyMiddleware`
 * takes by refusing to boot without `API_KEY`, just enforced per-request
 * here since a guard (unlike middleware built at module-init time) can't
 * refuse to start the app. The ONLY way around that is the explicit,
 * loudly-logged dev flag `ALLOW_UNAUTHENTICATED_ADMIN_DEV=true` — for local
 * development only, never to be set in a deployed environment.
 */
@Injectable()
export class SsoAuthGuard implements CanActivate {
  private readonly logger = new Logger(SsoAuthGuard.name);

  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const ssoBaseUrl = this.configService.get<string>('security.ssoBaseUrl');
    if (!ssoBaseUrl) {
      if (process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV === 'true') {
        // eslint-disable-next-line no-console
        console.warn(
          '[SsoAuthGuard] ALLOW_UNAUTHENTICATED_ADMIN_DEV=true — bypassing the ' +
            'SSO check because SSO_BASE_URL is not set. This request was let ' +
            'through with NO authentication. Local development only: this ' +
            'flag must never be set in a deployed environment.',
        );
        return true;
      }
      throw new UnauthorizedException(
        'SSO_BASE_URL is not configured — refusing every admin request until it is set',
      );
    }

    const authorization = req.header('authorization');
    if (!authorization) {
      throw new UnauthorizedException('Authorization: Bearer <access_token> header is required');
    }

    const headers: Record<string, string> = { Authorization: authorization };
    const refreshToken = req.header('x-refresh-token');
    if (refreshToken) headers['x-refresh-token'] = refreshToken;

    let profileRes: globalThis.Response;
    try {
      profileRes = await fetch(`${ssoBaseUrl.replace(/\/$/, '')}/auth/profile`, { headers });
    } catch (error) {
      this.logger.warn(
        `Could not reach SSO backend at ${ssoBaseUrl}: ${(error as Error).message}`,
      );
      throw new UnauthorizedException('Could not reach the SSO backend to verify this session');
    }

    if (!profileRes.ok) {
      throw new UnauthorizedException('SSO session is not valid');
    }

    const body = (await profileRes.json().catch(() => null)) as { authenticated?: boolean } | null;
    if (!body || body.authenticated !== true) {
      throw new UnauthorizedException('SSO session is not authenticated');
    }

    return true;
  }
}
