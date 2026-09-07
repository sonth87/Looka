import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SsoAuthGuard } from './sso-auth.guard';

/** Minimal fake matching what the guard actually reads off ExecutionContext. */
function contextWithHeaders(headers: Record<string, string | undefined>): ExecutionContext {
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function configServiceReturning(ssoBaseUrl: string | undefined): ConfigService {
  return { get: () => ssoBaseUrl } as unknown as ConfigService;
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
      const guard = new SsoAuthGuard(configServiceReturning(undefined));

      await expect(
        guard.canActivate(contextWithHeaders({ authorization: 'Bearer whatever' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('allows the request and warns loudly when ALLOW_UNAUTHENTICATED_ADMIN_DEV=true', async () => {
      process.env.ALLOW_UNAUTHENTICATED_ADMIN_DEV = 'true';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const guard = new SsoAuthGuard(configServiceReturning(undefined));

      await expect(guard.canActivate(contextWithHeaders({}))).resolves.toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('SSO_BASE_URL configured', () => {
    const ssoBaseUrl = 'https://test-login.dainam.edu.vn/';

    it('rejects when no Authorization header is sent', async () => {
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl));

      await expect(guard.canActivate(contextWithHeaders({}))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when the SSO backend cannot be reached', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl));

      await expect(
        guard.canActivate(contextWithHeaders({ authorization: 'Bearer token' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when GET /auth/profile responds with a non-OK status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false }) as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl));

      await expect(
        guard.canActivate(contextWithHeaders({ authorization: 'Bearer token' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when the profile body has authenticated !== true', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ authenticated: false }),
      }) as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl));

      await expect(
        guard.canActivate(contextWithHeaders({ authorization: 'Bearer token' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts and forwards Authorization + x-refresh-token when authenticated === true', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ authenticated: true }),
      });
      global.fetch = fetchMock as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl));

      const result = await guard.canActivate(
        contextWithHeaders({ authorization: 'Bearer abc', 'x-refresh-token': 'refresh-xyz' }),
      );

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test-login.dainam.edu.vn/auth/profile',
        {
          headers: { Authorization: 'Bearer abc', 'x-refresh-token': 'refresh-xyz' },
        },
      );
    });

    it('does not send x-refresh-token when the caller did not send one', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ authenticated: true }),
      });
      global.fetch = fetchMock as never;
      const guard = new SsoAuthGuard(configServiceReturning(ssoBaseUrl));

      await guard.canActivate(contextWithHeaders({ authorization: 'Bearer abc' }));

      expect(fetchMock).toHaveBeenCalledWith('https://test-login.dainam.edu.vn/auth/profile', {
        headers: { Authorization: 'Bearer abc' },
      });
    });
  });
});
