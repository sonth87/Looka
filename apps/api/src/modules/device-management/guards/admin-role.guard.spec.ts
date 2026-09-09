import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminRoleGuard } from './admin-role.guard';

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminRoleGuard', () => {
  let guard: AdminRoleGuard;

  beforeEach(() => {
    guard = new AdminRoleGuard();
  });

  test('allows a request whose req.user.isAdmin is true', () => {
    expect(
      guard.canActivate(contextWithUser({ id: 'u1', isAdmin: true })),
    ).toBe(true);
  });

  test('refuses a request whose req.user.isAdmin is false', () => {
    expect(() =>
      guard.canActivate(contextWithUser({ id: 'u1', isAdmin: false })),
    ).toThrow(ForbiddenException);
  });

  test('refuses a request with no req.user at all (guard used without SsoAuthGuard in front of it)', () => {
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(
      ForbiddenException,
    );
  });

  test('refuses a request whose req.user has no isAdmin field', () => {
    expect(() => guard.canActivate(contextWithUser({ id: 'u1' }))).toThrow(
      ForbiddenException,
    );
  });
});
