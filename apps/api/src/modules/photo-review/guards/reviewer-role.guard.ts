import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

/**
 * Gate for the photo-review CMS surface (plan §7) — REVIEWER role or admin.
 * Must run AFTER `SsoAuthGuard` (which attaches `req.user`), e.g.
 * `@UseGuards(SsoAuthGuard, ReviewerRoleGuard)`.
 *
 * Deliberately a self-contained copy of the same shape an `AdminRoleGuard`
 * would have, rather than an import from `device-management/guards/` — per
 * this task's own brief, that guard may not exist yet (another agent may be
 * building it concurrently), and this check is only a few lines against the
 * already-shared `req.user` (see `apps/api/src/common/guards/sso-auth.guard.ts`
 * and `apps/api/src/common/types/express.d.ts`). Not imported here — see
 * that same `sso-auth.guard.ts`'s own comment on why `express.d.ts` must
 * not be explicitly imported (ts-jest resolves a `.d.ts` as a real module
 * and fails to find one); the ambient global augmentation still applies via
 * tsconfig's normal `include` glob.
 */
@Injectable()
export class ReviewerRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.user?.isAdmin || req.user?.roles?.includes('REVIEWER')) {
      return true;
    }
    throw new ForbiddenException('Requires REVIEWER role or admin');
  }
}
