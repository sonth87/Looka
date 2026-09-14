import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserPermissionReadRepository } from '../../infrastructure/read/user-permission.read-repository';
import { REQUIRE_PERMISSION_METADATA } from './require-permission.decorator';

interface CacheEntry {
  codes: Set<string>;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

/**
 * Enforces `@RequirePermission(code)`. Must run AFTER `SsoAuthGuard` on the
 * same route (`@UseGuards(SsoAuthGuard, PermissionsGuard)`) — it reads
 * `req.user` that guard attaches and does not itself validate the token.
 *
 * `req.user.isAdmin` is a fast-path bypass (matches the pre-existing
 * meaning of that flag across `AdminRoleGuard`/`ReviewerRoleGuard` — an
 * admin already has every permission, so there is no need to also check
 * `user_roles` for one). Everyone else is checked against the granted
 * permission codes for their account, cached 60s per user id — same TTL
 * and same "process-local Map, not Redis" reasoning `SsoAuthGuard`'s own
 * profile cache already documents (multiple replicas re-check within a
 * minute; acceptable for a kiosk/CMS traffic pattern, per that guard's
 * doc comment).
 *
 * A route with no `@RequirePermission` decorator passes through
 * unconditionally — this guard is opt-in per route, not a global deny-all.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly reflector: Reflector,
    private readonly userPermissions: UserPermissionReadRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      { code: string; description?: string } | undefined
    >(REQUIRE_PERMISSION_METADATA, [context.getHandler(), context.getClass()]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Chưa đăng nhập.');
    }
    if (user.isAdmin) return true;

    const codes = await this.grantedCodes(user.id);
    if (codes.has(required.code)) return true;

    throw new ForbiddenException(
      `Thiếu quyền "${required.code}"${required.description ? ` (${required.description})` : ''}.`,
    );
  }

  private async grantedCodes(userId: string): Promise<Set<string>> {
    const cached = this.cache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.codes;

    const codes = await this.userPermissions.getGrantedCodes(userId);
    this.cache.set(userId, { codes, expiresAt: now + CACHE_TTL_MS });
    if (this.cache.size > 500) {
      for (const [key, entry] of this.cache) {
        if (entry.expiresAt <= now) this.cache.delete(key);
      }
    }
    return codes;
  }
}
