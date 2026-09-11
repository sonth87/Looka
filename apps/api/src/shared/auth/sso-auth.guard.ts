import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../../modules/shared/entities/user.entity';
import {
  fetchSsoProfile,
  SsoProfileResponse,
} from '../integrations/sso/sso-profile.adapter';
// `../types/express.d.ts` augments Express's `Request.user` globally — a
// type-only ambient declaration file, picked up by `tsc` via its normal
// `include` glob without an explicit import (and must NOT be imported here:
// ts-jest/Jest resolve a `.d.ts` as a real module and fail to find one).

/** What downstream guards/controllers see on `req.user` after this guard runs. */
export interface AuthenticatedUser {
  id: string;
  ssoUserCode: string;
  email: string;
  displayName?: string | null;
  isAdmin: boolean;
  roles: string[];
  /** Raw `staff_info` from the SSO profile, if the account has one — LOGIN.md §9. */
  staffInfo?: Record<string, unknown> | null;
}

interface CacheEntry {
  profile: SsoProfileResponse;
  expiresAt: number;
}

const PROFILE_CACHE_TTL_MS = 60_000;

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
 * **Updated 2026-09-08** (see
 * docs/plans/campaign-config-sso-card-photo-discussion.md §3.2.3): this
 * guard now also protects every ordinary user-facing route (kiosk/web
 * login, campaign picking, self-enroll, photo review), not just the
 * admin-only CMS surface — so two things changed from the original design:
 *
 * 1. **`req.user` is attached on success.** Downstream guards
 *    (`AdminRoleGuard`, `CampaignMemberGuard`, `ReviewerRoleGuard`) and
 *    controllers read `req.user` instead of re-deriving identity. The SSO
 *    profile is upserted into the local `users` table (`sso_user_code` is
 *    the natural key) so `isAdmin`/`roles` — concepts the SSO itself has no
 *    notion of — persist locally. See `User` entity's own doc comment for
 *    the `ADMIN_EMAILS` bootstrap rule.
 * 2. **A short (60s) in-memory cache** on the raw `Authorization` header
 *    value, so a kiosk/web client re-checking membership/campaign state
 *    frequently doesn't cost a network round trip to the SSO on every
 *    single request. This is deliberately process-local (a `Map`, not
 *    Redis) — multiple API replicas each keep their own cache, which only
 *    means a revoked SSO session can take up to 60s longer to take effect
 *    on a replica that isn't hit again soon; every replica still re-checks
 *    with the SSO backend within one minute regardless. If a real,
 *    shared, more precise revocation SLA is ever needed, replace this with
 *    a shared cache — not required for this system's actual usage pattern
 *    (a kiosk/CMS polling every few seconds to tens of seconds).
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
 * development only, never to be set in a deployed environment. In that dev
 * bypass path, a synthetic `req.user` (isAdmin: true) is still attached so
 * admin/reviewer-role-gated routes remain testable locally without a real
 * SSO backend.
 */
@Injectable()
export class SsoAuthGuard implements CanActivate {
  private readonly logger = new Logger(SsoAuthGuard.name);
  private readonly profileCache = new Map<string, CacheEntry>();

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authorization = req.header('authorization');

    // Dev-mock short-circuit — checked FIRST, independent of whether
    // SSO_BASE_URL is configured. Only ever matches
    // `DevAuthClient.authHeaders()`'s own `Bearer dev-mock:<email>` format
    // (packages/ui/src/lib/authClient.ts), which a real SSO client can
    // never produce — so the desktop app's local mock login and a real
    // SSO-backed CMS session can both hit this same API instance at once,
    // without toggling SSO_BASE_URL in .env back and forth every time
    // someone switches between testing the two. Fixed 2026-09-08: an
    // earlier version of this guard only bypassed when SSO_BASE_URL was
    // unset, which meant turning on the dev bypass to test the desktop
    // app's mock login silently broke every REAL SSO session too — a real
    // bearer token got treated as the generic dev-bypass identity instead
    // of being validated, so an actually-signed-in admin got 403'd by
    // AdminRoleGuard. Never triggers in a deployed environment: the exact
    // `dev-mock:` prefix is not something any real client sends.
    if (process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV === 'true') {
      const devMockMatch = /^Bearer dev-mock:(.+)$/.exec(authorization ?? '');
      if (devMockMatch) {
        console.warn(
          '[SsoAuthGuard] ALLOW_UNAUTHENTICATED_ADMIN_DEV=true — accepting a ' +
            'local dev-mock login with NO real authentication. Local ' +
            'development only: this flag must never be set in a deployed ' +
            'environment.',
        );
        const email = decodeURIComponent(devMockMatch[1]);
        const localPart = email.split('@')[0] || 'dev-bypass';
        req.user = await this.upsertUser({
          user_code: `dev:${localPart}`,
          email,
          name: localPart,
        });
        return true;
      }
    }

    const ssoBaseUrl = this.configService.get<string>('security.ssoBaseUrl');
    if (!ssoBaseUrl) {
      if (process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV === 'true') {
        console.warn(
          '[SsoAuthGuard] ALLOW_UNAUTHENTICATED_ADMIN_DEV=true — bypassing the ' +
            'real SSO check because SSO_BASE_URL is not set and no dev-mock ' +
            'header was sent (a bare curl/test request). NO real ' +
            'authentication happened. Local development only.',
        );
        req.user = await this.upsertUser({
          user_code: 'dev:dev-bypass',
          email: 'dev-bypass@localhost',
          name: 'dev-bypass',
        });
        return true;
      }
      throw new UnauthorizedException(
        'SSO_BASE_URL is not configured — refusing every admin request until it is set',
      );
    }

    if (!authorization) {
      throw new UnauthorizedException(
        'Authorization: Bearer <access_token> header is required',
      );
    }

    const profile = await this.getProfile(
      ssoBaseUrl,
      authorization,
      req.header('x-refresh-token'),
    );

    if (!profile || profile.authenticated !== true || !profile.user) {
      throw new UnauthorizedException('SSO session is not authenticated');
    }

    req.user = await this.upsertUser(profile.user);
    return true;
  }

  /** Cached-by-token profile fetch — see this class's doc comment for the TTL rationale. */
  private async getProfile(
    ssoBaseUrl: string,
    authorization: string,
    refreshToken?: string,
  ): Promise<SsoProfileResponse | null> {
    const cacheKey = `${authorization}::${refreshToken ?? ''}`;
    const cached = this.profileCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.profile;
    }

    const outcome = await fetchSsoProfile(
      ssoBaseUrl,
      authorization,
      refreshToken,
    );

    if (outcome.kind === 'Retryable') {
      this.logger.warn(outcome.reason);
      throw new UnauthorizedException(
        'Could not reach the SSO backend to verify this session',
      );
    }
    if (outcome.kind !== 'Success') {
      throw new UnauthorizedException('SSO session is not valid');
    }

    const body = outcome.value;
    if (body) {
      this.profileCache.set(cacheKey, {
        profile: body,
        expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
      });
      // Opportunistic cleanup so this Map never grows unbounded across a
      // long-running process — cheap relative to the network call above.
      if (this.profileCache.size > 500) {
        const now = Date.now();
        for (const [key, entry] of this.profileCache) {
          if (entry.expiresAt <= now) this.profileCache.delete(key);
        }
      }
    }
    return body;
  }

  private async upsertUser(
    ssoUser: NonNullable<SsoProfileResponse['user']>,
  ): Promise<AuthenticatedUser> {
    let user = await this.userRepo.findOne({
      where: { ssoUserCode: ssoUser.user_code },
    });
    const adminEmails =
      this.configService.get<string[]>('security.adminEmails') ?? [];
    const now = new Date();

    if (!user) {
      const anyAdminExists =
        (await this.userRepo.count({ where: { isAdmin: true } })) > 0;
      const bootstrapAdmin =
        !anyAdminExists && adminEmails.includes(ssoUser.email.toLowerCase());
      user = this.userRepo.create({
        ssoUserCode: ssoUser.user_code,
        email: ssoUser.email,
        displayName: ssoUser.name ?? null,
        isAdmin: bootstrapAdmin,
        roles: [],
        lastLoginAt: now,
      });
      user = await this.userRepo.save(user);
      if (bootstrapAdmin) {
        this.logger.warn(
          `[SsoAuthGuard] Bootstrapped first admin from ADMIN_EMAILS: ${ssoUser.email} (${ssoUser.user_code})`,
        );
      }
    } else {
      user.email = ssoUser.email;
      user.displayName = ssoUser.name ?? user.displayName;
      user.lastLoginAt = now;
      user = await this.userRepo.save(user);
    }

    return {
      id: user.id,
      ssoUserCode: user.ssoUserCode,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      roles: user.roles,
      staffInfo: ssoUser.staff_info ?? null,
    };
  }
}
