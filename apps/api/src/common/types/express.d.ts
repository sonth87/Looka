import type { AuthenticatedUser } from '../guards/sso-auth.guard';

/**
 * Augments Express's `Request` with the `user` field `SsoAuthGuard`
 * attaches on success — see that guard's own doc comment. Every downstream
 * guard/controller that reads `req.user` (AdminRoleGuard, ReviewerRoleGuard,
 * CampaignMemberGuard, and any controller wanting "who is calling") should
 * import this file (side-effect import, `import '@app/common/types/express'`)
 * rather than re-declaring the shape.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
