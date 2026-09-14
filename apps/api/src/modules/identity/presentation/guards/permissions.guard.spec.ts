import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@app/shared/auth/index';
import { UserPermissionReadRepository } from '../../infrastructure/read/user-permission.read-repository';
import { PermissionsGuard } from './permissions.guard';

function contextFor(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}) as unknown,
    getClass: () => ({}) as unknown,
  } as unknown as ExecutionContext;
}

function reflectorReturning(
  metadata: { code: string; description?: string } | undefined,
): Reflector {
  return {
    getAllAndOverride: jest.fn(() => metadata),
  } as unknown as Reflector;
}

/**
 * Returns the fake repository AND the bare mock function separately (not
 * `repo.getGrantedCodes`) — asserting on a property access typed as a
 * class method trips `@typescript-eslint/unbound-method` ("may cause
 * unintentional scoping of `this`"); a plain standalone reference, same
 * pattern `sso-auth.guard.spec.ts`'s own `fetchMock` already uses, does
 * not.
 *
 * Not `async` — the mock returns a plain Set, not a Promise; the guard's
 * own `await` on it still works (`await` on a non-promise resolves to the
 * value itself). An `async` arrow with no `await` inside trips
 * `@typescript-eslint/require-await`.
 */
function fakeUserPermissions(codes: string[]): {
  repo: UserPermissionReadRepository;
  getGrantedCodes: jest.Mock;
} {
  const getGrantedCodes = jest.fn(() => new Set(codes));
  return {
    repo: { getGrantedCodes } as unknown as UserPermissionReadRepository,
    getGrantedCodes,
  };
}

const baseUser: AuthenticatedUser = {
  id: 'user-1',
  ssoUserCode: 'GV001',
  email: 'gv@dainam.edu.vn',
  isAdmin: false,
  roles: [],
};

describe('PermissionsGuard', () => {
  it('passes through when the route has no @RequirePermission metadata', async () => {
    const guard = new PermissionsGuard(
      reflectorReturning(undefined),
      fakeUserPermissions([]).repo,
    );
    await expect(guard.canActivate(contextFor(baseUser))).resolves.toBe(true);
  });

  it('rejects when there is no req.user (SsoAuthGuard did not run or failed)', async () => {
    const guard = new PermissionsGuard(
      reflectorReturning({ code: 'campaign:write' }),
      fakeUserPermissions([]).repo,
    );
    await expect(
      guard.canActivate(contextFor(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows an admin unconditionally, without consulting granted codes', async () => {
    const { repo, getGrantedCodes } = fakeUserPermissions([]);
    const guard = new PermissionsGuard(
      reflectorReturning({ code: 'campaign:delete' }),
      repo,
    );
    const admin = { ...baseUser, isAdmin: true };

    await expect(guard.canActivate(contextFor(admin))).resolves.toBe(true);
    expect(getGrantedCodes).not.toHaveBeenCalled();
  });

  it('allows a non-admin who has been granted the exact required code', async () => {
    const guard = new PermissionsGuard(
      reflectorReturning({ code: 'campaign:write' }),
      fakeUserPermissions(['campaign:write', 'campaign:read']).repo,
    );
    await expect(guard.canActivate(contextFor(baseUser))).resolves.toBe(true);
  });

  it('rejects a non-admin missing the required code, with a message naming it', async () => {
    const guard = new PermissionsGuard(
      reflectorReturning({
        code: 'campaign:delete',
        description: 'Xóa đợt chụp',
      }),
      fakeUserPermissions(['campaign:write']).repo,
    );
    await expect(guard.canActivate(contextFor(baseUser))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard.canActivate(contextFor(baseUser))).rejects.toThrow(
      /campaign:delete/,
    );
  });

  it('caches granted codes per user for the TTL window (one DB call for two checks)', async () => {
    const { repo, getGrantedCodes } = fakeUserPermissions(['campaign:write']);
    const guard = new PermissionsGuard(
      reflectorReturning({ code: 'campaign:write' }),
      repo,
    );

    await guard.canActivate(contextFor(baseUser));
    await guard.canActivate(contextFor(baseUser));

    expect(getGrantedCodes).toHaveBeenCalledTimes(1);
  });
});
