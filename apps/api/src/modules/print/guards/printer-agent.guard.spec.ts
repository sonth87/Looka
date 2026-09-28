import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Printer } from '../entities/printer.entity';
import { hashPrinterToken } from '../services/printer-token.util';
import { PrinterAgentGuard } from './printer-agent.guard';

/**
 * Print RBAC task, area 4 — proves `PrinterAgentGuard` is a completely
 * separate authn path from `PermissionsGuard`/`SsoAuthGuard`: a bearer
 * token hashed and looked up against `printers.agent_token_hash`, nothing
 * to do with `user_roles`/`role_permissions`, and — critically — it never
 * populates `req.user`. That last point is what rules out the "privilege
 * confusion" the task brief asks about: a printer-agent caller can never
 * look like a logged-in CMS user to a route that DOES use
 * `SsoAuthGuard`+`PermissionsGuard` (those guards read `req.user`, which
 * stays `undefined` here — `PermissionsGuard`'s own spec already covers
 * "no req.user → 401" for that side).
 */
function contextFor(req: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** Bare object matching the query-builder chain the guard calls — same "plain mock shape, cast at the call site" convention `printer.service.spec.ts`'s own `fakeManager` uses. */
function fakePrinterRepo(printer: Printer | null): {
  repo: Repository<Printer>;
  where: jest.Mock;
} {
  const where = jest.fn().mockReturnThis();
  const qb = {
    addSelect: jest.fn().mockReturnThis(),
    where,
    getOne: jest.fn().mockResolvedValue(printer),
  };
  return {
    repo: {
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<Printer>,
    where,
  };
}

function printerFixture(overrides: Partial<Printer> = {}): Printer {
  return {
    id: 'printer-1',
    status: 'ENABLED',
    agentTokenHash: hashPrinterToken('the-real-token'),
    ...overrides,
  } as Printer;
}

describe('PrinterAgentGuard', () => {
  it('rejects with no Authorization header at all', async () => {
    const { repo } = fakePrinterRepo(null);
    const guard = new PrinterAgentGuard(repo);
    await expect(
      guard.canActivate(
        contextFor({ header: () => undefined, query: {} } as never),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const { repo } = fakePrinterRepo(null);
    const guard = new PrinterAgentGuard(repo);
    const req = {
      header: (name: string) =>
        name === 'authorization' ? 'Basic abc123' : undefined,
      query: {},
    } as unknown as Request;
    await expect(guard.canActivate(contextFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('hashes the bearer token before lookup — never compares/stores it in plaintext', async () => {
    const printer = printerFixture();
    const { repo, where } = fakePrinterRepo(printer);
    const guard = new PrinterAgentGuard(repo);
    const req = {
      header: (name: string) =>
        name === 'authorization' ? 'Bearer the-real-token' : undefined,
      query: {},
    } as unknown as Request;

    await guard.canActivate(contextFor(req));

    expect(where).toHaveBeenCalledWith('p.agentTokenHash = :hash', {
      hash: hashPrinterToken('the-real-token'),
    });
  });

  it('rejects an unknown token hash (no matching printer row)', async () => {
    const { repo } = fakePrinterRepo(null);
    const guard = new PrinterAgentGuard(repo);
    const req = {
      header: (name: string) =>
        name === 'authorization' ? 'Bearer not-a-real-token' : undefined,
      query: {},
    } as unknown as Request;
    await expect(guard.canActivate(contextFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token that resolves to a DISABLED printer', async () => {
    const printer = printerFixture({ status: 'DISABLED' });
    const { repo } = fakePrinterRepo(printer);
    const guard = new PrinterAgentGuard(repo);
    const req = {
      header: (name: string) =>
        name === 'authorization' ? 'Bearer the-real-token' : undefined,
      query: {},
    } as unknown as Request;
    await expect(guard.canActivate(contextFor(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects when the optional printerId query param does not match the token’s own printer', async () => {
    const printer = printerFixture({ id: 'printer-1' });
    const { repo } = fakePrinterRepo(printer);
    const guard = new PrinterAgentGuard(repo);
    const req = {
      header: (name: string) =>
        name === 'authorization' ? 'Bearer the-real-token' : undefined,
      query: { printerId: 'printer-2' },
    } as unknown as Request;
    await expect(guard.canActivate(contextFor(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('accepts a valid token, sets req.printer, and — critically — never sets req.user', async () => {
    const printer = printerFixture({ id: 'printer-1' });
    const { repo } = fakePrinterRepo(printer);
    const guard = new PrinterAgentGuard(repo);
    const req = {
      header: (name: string) =>
        name === 'authorization' ? 'Bearer the-real-token' : undefined,
      query: {},
    } as unknown as Request;

    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
    expect(req.printer).toBe(printer);
    // The concrete reason this guard cannot be confused for a logged-in
    // user by a downstream `SsoAuthGuard`+`PermissionsGuard`-gated route:
    // it has no notion of `req.user` at all.
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
  });
});
