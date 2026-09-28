import type { Server } from 'node:http';
import request from 'supertest';
import {
  ExecutionContext,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '@app/shared/auth/index';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { UserPermissionReadRepository } from '@app/modules/identity/infrastructure/read/user-permission.read-repository';
import { PrintBatchController } from './print-batch.controller';
import { PrinterController } from './printer.controller';
import { PrintResultImportController } from './print-result-import.controller';
import { PrintBatchService } from '../services/print-batch.service';
import { PrinterService } from '../services/printer.service';
import { PrintResultImportService } from '../services/print-result-import.service';

/**
 * Print RBAC task, area 2 — "guard enforcement, real HTTP-level test per
 * action". Boots a REAL Nest HTTP server (supertest against
 * `app.getHttpServer()`, real `@RequirePermission`/`@UseGuards` decorators,
 * real `PermissionsGuard`+`Reflector`) for a representative slice of print
 * routes: list/create/populate/exportPackage on `PrintBatchController`,
 * list/create on `PrinterController`, and the multipart upload-result route
 * on `PrintResultImportController`.
 *
 * Only two things are faked, the minimum needed to avoid a real SSO round
 * trip and a real Postgres:
 *  - `SsoAuthGuard` is replaced with a stub that reads a `x-test-granted`
 *    header (comma-separated permission codes, may be empty) and attaches
 *    `req.user` with `id` set to that SAME header value — this doubles as
 *    the "logged in as" identity AND the lookup key `UserPermissionReadRepository`
 *    reads, so each test case gets an isolated `PermissionsGuard` 60s cache
 *    entry (different code sets never share a cache key) without needing to
 *    fake time or construct a fresh guard instance per case.
 *  - `UserPermissionReadRepository.getGrantedCodes` reads that same encoded
 *    id back into a `Set<string>` instead of querying `role_permissions`.
 *
 * Every business service (`PrintBatchService`/`PrinterService`/
 * `PrintResultImportService`) is a trivial stub — this file is about the
 * guard chain, not business logic (already covered by each service's own
 * spec file).
 */
describe('print module — PermissionsGuard enforcement over real HTTP routes', () => {
  let app: INestApplication;
  // `INestApplication.getHttpServer()` types as `any` — captured once, cast
  // once, here, rather than casting (or tripping `no-unsafe-argument` on)
  // every one of the 14 `request(...)` call sites below.
  let httpServer: Server;

  const ssoStub = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest<
        { headers: Record<string, string | undefined> } & {
          user?: AuthenticatedUser;
        }
      >();
      const granted = req.headers['x-test-granted'] ?? '';
      req.user = {
        id: granted,
        ssoUserCode: 'TEST',
        email: 'test@example.com',
        isAdmin: false,
        roles: [],
      };
      return true;
    },
  };

  const fakeUserPermissions = {
    getGrantedCodes: jest.fn((userId: string) =>
      Promise.resolve(new Set(userId.split(',').filter(Boolean))),
    ),
  };

  const batchService = {
    list: jest.fn().mockResolvedValue({ items: [], meta: { total: 0 } }),
    create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
    populate: jest
      .fn()
      .mockResolvedValue({ created: 0, attached: 0, skipped: [] }),
    exportPackage: jest.fn().mockResolvedValue({
      zip: Buffer.from('fake-zip'),
      filename: 'test.zip',
      failedItemIds: [],
    }),
  };

  const printerService = {
    list: jest.fn().mockResolvedValue({ items: [], meta: { total: 0 } }),
    create: jest.fn().mockResolvedValue({ id: 'printer-1' }),
  };

  const resultImportService = {
    importResults: jest.fn().mockResolvedValue({ id: 'import-1' }),
  };

  beforeAll(async () => {
    // `SsoAuthGuard` is bound via `@UseGuards()` on each controller, not
    // constructor-injected anywhere — Nest resolves decorator-bound guards
    // through a separate path from ordinary DI, so a plain
    // `{ provide: SsoAuthGuard, useValue }` provider entry is silently
    // ignored (confirmed live: without `.overrideGuard()`, Nest still tried
    // to build the REAL `SsoAuthGuard`, demanding `ConfigService`/
    // `Repository<User>`). `.overrideGuard()` is the dedicated Nest testing
    // API for exactly this case. `UserPermissionReadRepository`, by
    // contrast, IS a normal constructor-injected dependency of
    // `PermissionsGuard`, so overriding it via an ordinary provider entry
    // works.
    const moduleRef = await Test.createTestingModule({
      controllers: [
        PrintBatchController,
        PrinterController,
        PrintResultImportController,
      ],
      providers: [
        PermissionsGuard,
        {
          provide: UserPermissionReadRepository,
          useValue: fakeUserPermissions,
        },
        { provide: PrintBatchService, useValue: batchService },
        { provide: PrinterService, useValue: printerService },
        { provide: PrintResultImportService, useValue: resultImportService },
      ],
    })
      .overrideGuard(SsoAuthGuard)
      .useValue(ssoStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, prefix: 'v' });
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Omitting the header entirely when there are no codes (rather than
  // sending it empty) sidesteps any ambiguity in how a given HTTP client
  // handles an empty header value — `ssoStub` already treats "header
  // absent" the same as "granted nothing" via its own `?? ''` fallback.
  const granted = (...codes: string[]): Record<string, string> =>
    codes.length > 0 ? { 'x-test-granted': codes.join(',') } : {};

  describe('GET /v1/print/batches (print-batch:read)', () => {
    it('403s a caller with no permission', async () => {
      await request(httpServer)
        .get('/v1/print/batches')
        .set(granted())
        .expect(403);
      expect(batchService.list).not.toHaveBeenCalled();
    });

    it('succeeds for a caller granted print-batch:read', async () => {
      await request(httpServer)
        .get('/v1/print/batches')
        .set(granted('print-batch:read'))
        .expect(200);
      expect(batchService.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /v1/print/batches (print-batch:write)', () => {
    it('403s a caller with only print-batch:read', async () => {
      await request(httpServer)
        .post('/v1/print/batches')
        .set(granted('print-batch:read'))
        .send({ name: 'Đợt in test' })
        .expect(403);
      expect(batchService.create).not.toHaveBeenCalled();
    });

    it('succeeds for a caller granted print-batch:write', async () => {
      // Nest's default status for POST is 201 — no `@HttpCode` on this
      // handler, and `@ApiResponseDecorator` (Swagger-only, see that
      // decorator's own doc comment) never touches the runtime status.
      await request(httpServer)
        .post('/v1/print/batches')
        .set(granted('print-batch:write'))
        .send({ name: 'Đợt in test' })
        .expect(201);
      expect(batchService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /v1/print/batches/:id/populate (print-batch:write)', () => {
    it('403s without print-batch:write', async () => {
      await request(httpServer)
        .post('/v1/print/batches/batch-1/populate')
        .set(granted('print-batch:read'))
        .expect(403);
      expect(batchService.populate).not.toHaveBeenCalled();
    });

    it('succeeds with print-batch:write', async () => {
      await request(httpServer)
        .post('/v1/print/batches/batch-1/populate')
        .set(granted('print-batch:write'))
        .expect(201);
      expect(batchService.populate).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /v1/print/batches/:id/package — "Xuất gói" (print-batch:write)', () => {
    it('403s without print-batch:write', async () => {
      await request(httpServer)
        .post('/v1/print/batches/batch-1/package')
        .set(granted('print-batch:read'))
        .send({})
        .expect(403);
      expect(batchService.exportPackage).not.toHaveBeenCalled();
    });

    it('succeeds with print-batch:write', async () => {
      await request(httpServer)
        .post('/v1/print/batches/batch-1/package')
        .set(granted('print-batch:write'))
        .send({})
        .expect(201);
      expect(batchService.exportPackage).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /v1/printers (printer:read)', () => {
    it('403s a caller with no permission', async () => {
      await request(httpServer).get('/v1/printers').set(granted()).expect(403);
      expect(printerService.list).not.toHaveBeenCalled();
    });

    it('succeeds for a caller granted printer:read', async () => {
      await request(httpServer)
        .get('/v1/printers')
        .set(granted('printer:read'))
        .expect(200);
      expect(printerService.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /v1/printers (printer:write)', () => {
    it('403s a caller with only printer:read', async () => {
      await request(httpServer)
        .post('/v1/printers')
        .set(granted('printer:read'))
        .send({ name: 'Máy in test' })
        .expect(403);
      expect(printerService.create).not.toHaveBeenCalled();
    });

    it('succeeds for a caller granted printer:write', async () => {
      await request(httpServer)
        .post('/v1/printers')
        .set(granted('printer:write'))
        .send({ name: 'Máy in test' })
        .expect(201);
      expect(printerService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /v1/print/batches/:id/result-imports — upload kết quả in (print-batch:write)', () => {
    it('403s without print-batch:write, before ever reaching the multipart interceptor/handler', async () => {
      await request(httpServer)
        .post('/v1/print/batches/batch-1/result-imports')
        .set(granted('print-batch:read'))
        .expect(403);
      expect(resultImportService.importResults).not.toHaveBeenCalled();
    });

    it('succeeds with print-batch:write (no file attached — guard-phase check only)', async () => {
      await request(httpServer)
        .post('/v1/print/batches/batch-1/result-imports')
        .set(granted('print-batch:write'))
        .expect(201);
      expect(resultImportService.importResults).toHaveBeenCalledTimes(1);
    });
  });
});
