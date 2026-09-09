import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { User } from '../../modules/shared/entities/user.entity';
import { SsoAuthGuard } from './sso-auth.guard';

/** Minimal fake matching what the guard actually reads off ExecutionContext. */
function contextWithHeaders(headers: Record<string, string | undefined>): ExecutionContext {
  const req: Record<string, unknown> = {
    header: (name: string) => headers[name.toLowerCase()],
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function configServiceReturning(ssoBaseUrl: string | undefined, adminEmails: string[] = []): ConfigService {
  return {
    get: (key: string) => (key === 'security.ssoBaseUrl' ? ssoBaseUrl : adminEmails),
  } as unknown as ConfigService;
}

/** In-memory fake `Repository<User>` — enough surface for `SsoAuthGuard.upsertUser`. */
function fakeUserRepo(existing: Partial<User>[] = []): Repository<User> {
  const rows = [...existing] as User[];
  return {
    findOne: jest.fn(async ({ where }: { where: { ssoUserCode: string } }) =>
      rows.find((r) => r.ssoUserCode === where.ssoUserCode) ?? null,
    ),
    count: jest.fn(async ({ where }: { where: { isAdmin: boolean } }) =>
      rows.filter((r) => r.isAdmin === where.isAdmin).length,
    ),
    create: jest.fn((data: Partial<User>) => ({ id: `id-${rows.length + 1}`, ...data }) as User),
    save: jest.fn(async (user: User) => {
      const idx = rows.findIndex((r) => r.id === user.id);
      if (idx >= 0) rows[idx] = user;
      else rows.push(user);
      return user;
    }),
  } as unknown as Repository<User>;
}

describe('SsoAuthGuard', () => {
  const originalFetch = global.fetch;
  const originalFlag = process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalFlag === undefined) {
      delete process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV;
    } else {
      process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV = originalFlag;
    }
    jest.restoreAllMocks();
  });

  describe('SSO_BASE_URL unset (fail closed)', () => {
    it('rejects every request when the dev bypass flag is not set', async () => {
      delete process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV;
      const guard = new SsoAuthGuard(configServiceReturning(undefined), fakeUserRepo());

      await expect(
        guard.canActivate(contextWithHeaders({ authorization: 'Bearer whatever' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('allows the request, warns loudly, and upserts a real user with no admin bootstrap configured, when ALLOW_UNAUTHENTICATED_ADMIN_DEV=true', async () => {
      process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV = 'true';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const guard = new SsoAuthGuard(configServiceReturning(undefined), fakeUserRepo());
      const ctx = contextWithHeaders({});

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(warnSpy).toHaveBeenCalled();
      const req = ctx.switchToHttp().getRequest() as { user?: { isAdmin: boolean; email: string } };
      expect(req.user?.email).toBe('dev-bypass@localhost');
      expect(req.user?.isAdmin).toBe(false);
    });

    it('the dev bypass reads the email off a DevAuthClient-style "Bearer dev-mock:<email>" header and bootstraps admin from ADMIN_EMAILS', async () => {
      process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV = 'true';
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const guard = new SsoAuthGuard(
        configServiceReturning(undefined, ['sontt@dainam.edu.vn']),
        fakeUserRepo(),
      );
      const ctx = contextWithHeaders({
        authorization: `Bearer dev-mock:${encodeURIComponent('sontt@dainam.edu.vn')}`,
      });

      await guard.canActivate(ctx);

      const req = ctx.switchToHttp().getRequest() as { user?: { isAdmin: boolean; email: string } };
      expect(req.user?.email).toBe('sontt@dainam.edu.vn');
      expect(req.user?.isAdmin).toBe(true);
    });

    it('two different dev-mock emails resolve to two different users, not one shared identity', async () => {
      process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV = 'true';
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const repo = fakeUserRepo();
      const guard = new SsoAuthGuard(configServiceReturning(undefined), repo);

      const ctxA = contextWithHeaders({ authorization: `Bearer dev-mock:${encodeURIComponent('a@dainam.edu.vn')}` });
      const ctxB = contextWithHeaders({ authorization: `Bearer dev-mock:${encodeURIComponent('b@dainam.edu.vn')}` });
      await guard.canActivate(ctxA);
      await guard.canActivate(ctxB);

      const userA = (ctxA.switchToHttp().getRequest() as { user?: { id: string } }).user;
      const userB = (ctxB.switchToHttp().getRequest() as { user?: { id: string } }).user;
      expect(userA?.id).not.toBe(userB?.id);
    });
  });

  describe('SSO_BASE_URL configured', () => {
    const ssoBaseUrl = 'https://test-login.dainam.edu.vn/';

    it('REGRESSION (2026-09-08): a real bearer token still goes through real SSO validation, not the dev-mock shortcut, even when ALLOW_UNAUTHENTICATED_ADMIN_DEV=true — this is the exact bug that returned 403 for a real logged-in CMS admin', async () => {
      process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV = 'true';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authenticated: true,
            user: { email: 'sontt@dainam.edu.vn', user_code: 'USR023230' },
          }),
      });
      global.fetch = fetchMock as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl), fakeUserRepo());

      const ctx = contextWithHeaders({ authorization: 'Bearer real-sso-access-token' });
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test-login.dainam.edu.vn/auth/profile',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer real-sso-access-token' }) }),
      );
      const req = ctx.switchToHttp().getRequest() as { user?: { email: string } };
      expect(req.user?.email).toBe('sontt@dainam.edu.vn');
    });

    it('a dev-mock login still works via the local shortcut even when SSO_BASE_URL is configured, without ever calling the real SSO backend', async () => {
      process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV = 'true';
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fetchMock = jest.fn();
      global.fetch = fetchMock as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl), fakeUserRepo());

      const ctx = contextWithHeaders({
        authorization: `Bearer dev-mock:${encodeURIComponent('operator@dainam.edu.vn')}`,
      });
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      const req = ctx.switchToHttp().getRequest() as { user?: { email: string } };
      expect(req.user?.email).toBe('operator@dainam.edu.vn');
    });

    it('rejects when no Authorization header is sent', async () => {
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl), fakeUserRepo());

      await expect(guard.canActivate(contextWithHeaders({}))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when the SSO backend cannot be reached', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl), fakeUserRepo());

      await expect(
        guard.canActivate(contextWithHeaders({ authorization: 'Bearer token' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when GET /auth/profile responds with a non-OK status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false }) as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl), fakeUserRepo());

      await expect(
        guard.canActivate(contextWithHeaders({ authorization: 'Bearer token' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when the profile body has authenticated !== true', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ authenticated: false }),
      }) as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl), fakeUserRepo());

      await expect(
        guard.canActivate(contextWithHeaders({ authorization: 'Bearer token' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts, forwards Authorization + x-refresh-token, and attaches req.user for a new user', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authenticated: true,
            user: { email: 'a@dainam.edu.vn', user_code: 'GV001', name: 'Nguyen Van A' },
          }),
      });
      global.fetch = fetchMock as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl), fakeUserRepo());

      const ctx = contextWithHeaders({ authorization: 'Bearer abc', 'x-refresh-token': 'refresh-xyz' });
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith('https://test-login.dainam.edu.vn/auth/profile', {
        headers: { Authorization: 'Bearer abc', 'x-refresh-token': 'refresh-xyz' },
      });
      const req = ctx.switchToHttp().getRequest() as { user?: { email: string; isAdmin: boolean } };
      expect(req.user?.email).toBe('a@dainam.edu.vn');
      expect(req.user?.isAdmin).toBe(false);
    });

    it('does not send x-refresh-token when the caller did not send one', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ authenticated: true, user: { email: 'b@dainam.edu.vn', user_code: 'GV002' } }),
      });
      global.fetch = fetchMock as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl), fakeUserRepo());

      await guard.canActivate(contextWithHeaders({ authorization: 'Bearer abc' }));

      expect(fetchMock).toHaveBeenCalledWith('https://test-login.dainam.edu.vn/auth/profile', {
        headers: { Authorization: 'Bearer abc' },
      });
    });

    it('caches the profile for 60s and does not re-fetch on the next request with the same token', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ authenticated: true, user: { email: 'c@dainam.edu.vn', user_code: 'GV003' } }),
      });
      global.fetch = fetchMock as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl), fakeUserRepo());

      await guard.canActivate(contextWithHeaders({ authorization: 'Bearer same-token' }));
      await guard.canActivate(contextWithHeaders({ authorization: 'Bearer same-token' }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('bootstraps the first admin from ADMIN_EMAILS when no admin exists yet', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authenticated: true,
            user: { email: 'boss@dainam.edu.vn', user_code: 'GV004' },
          }),
      });
      global.fetch = fetchMock as never;
      const guard = new SsoAuthGuard(
        configServiceReturning(ssoBaseUrl, ['boss@dainam.edu.vn']),
        fakeUserRepo(),
      );

      const ctx = contextWithHeaders({ authorization: 'Bearer boss-token' });
      await guard.canActivate(ctx);

      const req = ctx.switchToHttp().getRequest() as { user?: { isAdmin: boolean } };
      expect(req.user?.isAdmin).toBe(true);
    });

    it('does not bootstrap a second admin once one already exists', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authenticated: true,
            user: { email: 'second@dainam.edu.vn', user_code: 'GV005' },
          }),
      });
      global.fetch = fetchMock as never;
      const repo = fakeUserRepo([
        { id: 'existing-admin', ssoUserCode: 'GV000', email: 'first@dainam.edu.vn', isAdmin: true, roles: [] },
      ]);
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl, ['second@dainam.edu.vn']), repo);

      const ctx = contextWithHeaders({ authorization: 'Bearer second-token' });
      await guard.canActivate(ctx);

      const req = ctx.switchToHttp().getRequest() as { user?: { isAdmin: boolean } };
      expect(req.user?.isAdmin).toBe(false);
    });
  });
});
