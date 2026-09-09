import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Gate for CMS/admin-only routes (campaign create/update/delete stays open
 * to any SSO user today — see `CampaignController`'s own doc comment; this
 * guard is for the *new* surfaces added 2026-09-08 that specifically need
 * `users.is_admin`: capture-angle-preset CRUD, campaign-member approve/
 * reject/revoke). See
 * docs/plans/campaign-config-sso-card-photo-discussion.md §3.2.3.
 *
 * Meant to be stacked AFTER `SsoAuthGuard` — `@UseGuards(SsoAuthGuard,
 * AdminRoleGuard)` — never used alone: it only reads `req.user`, which
 * `SsoAuthGuard.canActivate` is what actually attaches. Used alone (no
 * `SsoAuthGuard` in front of it on the same route), `req.user` is always
 * undefined and every request is refused — a fail-closed default, not a
 * silent bypass, but still almost certainly a wiring mistake if it happens.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    if (!req.user?.isAdmin) {
      throw new ForbiddenException('Admin role required');
    }

    return true;
  }
}
