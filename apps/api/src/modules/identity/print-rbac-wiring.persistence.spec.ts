import { randomUUID } from 'node:crypto';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import type { AuthenticatedUser } from '@app/shared/auth/index';
import { FoundationModule } from '@app/shared/foundation.module';
import { SharedModule } from '@app/modules/shared/shared.module';
import { User } from '@app/modules/shared/entities/user.entity';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { IdentityModule } from '@app/modules/identity/identity.module';
import { PermissionEntity } from '@app/modules/identity/infrastructure/persistence/permission.entity';
import { RoleEntity } from '@app/modules/identity/infrastructure/persistence/role.entity';
import { RolePermissionEntity } from '@app/modules/identity/infrastructure/persistence/role-permission.entity';
import { UserRoleEntity } from '@app/modules/identity/infrastructure/persistence/user-role.entity';
import { UserPermissionReadRepository } from '@app/modules/identity/infrastructure/read/user-permission.read-repository';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { CreateRoleCommand } from '@app/modules/identity/application/commands/command/create-role.command';
import { SetRolePermissionsCommand } from '@app/modules/identity/application/commands/command/set-role-permissions.command';
import { CreateUserCommand } from '@app/modules/identity/application/commands/command/create-user.command';
import { SetUserRolesCommand } from '@app/modules/identity/application/commands/command/set-user-roles.command';
import { DeleteRoleCommand } from '@app/modules/identity/application/commands/command/delete-role.command';
import type { RoleResult } from '@app/modules/identity/application/commands/result/role.result';
import { PrintBatchController } from '@app/modules/print/controllers/print-batch.controller';

/**
 * Print RBAC task, area 3 — "role → permission → user wiring, live". Runs
 * against a real Postgres (same `TEST_DATABASE_URL`-gated convention as
 * `device-management-persistence.spec.ts`/`capture-report-persistence.spec.ts`):
 * boots the REAL `IdentityModule` (real `CommandBus`, real command handlers,
 * real `UnitOfWork` transactions, real `role_permissions`/`user_roles` SQL),
 * creates a throwaway role+user, and proves `PermissionsGuard` — also the
 * real class, only its `Reflector`/`UserPermissionReadRepository` are the
 * genuine ones this module wires up, nothing mocked — changes its verdict on
 * a REAL print route the moment the role's permission set changes in the DB.
 *
 * A fresh `PermissionsGuard` instance is constructed for each check (rather
 * than reusing one across the "before granting write" / "after granting
 * write" steps) specifically so its 60s in-memory grant cache never masks a
 * real permission change made moments earlier in the same test — the cache
 * itself is already covered by `permissions.guard.spec.ts`.
 *
 * `FileStorageService` is stubbed out (`useValue: {}`) purely to skip its
 * `onModuleInit()` — it throws if `FS_BASE_URL`-derived config is missing
 * from THIS minimal module's `ConfigService`, and nothing in this test's
 * path (creating a role/user, granting permissions) ever calls it; the
 * real service has its own tests elsewhere.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('print RBAC wiring — role → permission → user (live)', () => {
  let moduleRef: TestingModule;
  let commandBus: CommandBus;
  let dataSource: DataSource;
  let reflector: Reflector;
  let userPermissions: UserPermissionReadRepository;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url,
          entities: [
            RoleEntity,
            PermissionEntity,
            RolePermissionEntity,
            UserRoleEntity,
            User,
          ],
          namingStrategy: new SnakeNamingStrategy(),
          synchronize: false,
        }),
        // `IdentityModule`'s own CMS controllers (RoleCommandController etc.)
        // carry `@UseGuards(SsoAuthGuard, PermissionsGuard)` — Nest eagerly
        // constructs every provider in the graph at `compile()` time
        // regardless of whether a route is ever hit over HTTP (never is, in
        // this test — everything below goes through `CommandBus` directly),
        // and `SsoAuthGuard`'s constructor needs a real `Repository<User>`.
        // `SharedModule` (`@Global()`, real class — same one `AppModule`
        // imports) is what provides that in the real app; importing a bare
        // sibling `TypeOrmModule.forFeature([User])` here does NOT work
        // (confirmed live) since Nest module encapsulation means a
        // non-global sibling import's providers stay invisible to
        // `IdentityModule`'s own injector. `SsoAuthGuard.canActivate()`
        // (the part that would call out to SSO_BASE_URL) is never invoked
        // here regardless.
        SharedModule,
        FoundationModule,
        IdentityModule,
      ],
    })
      .overrideProvider(FileStorageService)
      .useValue({})
      .compile();

    // `.compile()` alone only constructs providers — `CqrsModule`'s own
    // explorer registers `@CommandHandler`s onto the bus from
    // `onApplicationBootstrap()` (confirmed live: without this, `execute()`
    // throws "No handler found for the command"), so lifecycle hooks must
    // actually run once. `FileStorageService` is overridden with a plain
    // `{}` above specifically so ITS `onModuleInit()` (which throws unless
    // `fileService.baseUrl` config is present — not set up in this minimal
    // module) never runs either.
    await moduleRef.init();

    commandBus = moduleRef.get(CommandBus);
    dataSource = moduleRef.get(DataSource);
    reflector = moduleRef.get(Reflector);
    userPermissions = moduleRef.get(UserPermissionReadRepository);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  function contextFor(
    user: AuthenticatedUser,
    handler: (...args: never[]) => unknown,
    cls: unknown,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => handler,
      getClass: () => cls,
    } as unknown as ExecutionContext;
  }

  it('a role with only print-batch:read lets its user list batches but not create one — granting print-batch:write then allows create', async () => {
    const roleCode = `E2E_PRINT_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const email = `e2e-print-rbac-${randomUUID()}@example.test`;
    let roleId: string | undefined;
    let userId: string | undefined;

    try {
      const role = await commandBus.execute<CreateRoleCommand, RoleResult>(
        new CreateRoleCommand(
          roleCode,
          'E2E print RBAC fixture role',
          'Tạo bởi print-rbac-wiring.persistence.spec.ts, tự xóa sau khi test xong',
        ),
      );
      roleId = role.id;

      await commandBus.execute(
        new SetRolePermissionsCommand(roleId, ['print-batch:read']),
      );

      const user = await commandBus.execute<CreateUserCommand, { id: string }>(
        new CreateUserCommand(
          'E2E Print RBAC Fixture',
          email,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          [roleId],
          null,
        ),
      );
      userId = user.id;

      const fixtureUser: AuthenticatedUser = {
        id: userId,
        ssoUserCode: `E2E:${userId}`,
        email,
        isAdmin: false,
        roles: [],
      };

      // Pre-extracted via a `Record<string, unknown>`-typed view of the
      // prototype, cast away from a "method" type before use — referencing
      // `SomeController.prototype.someMethod` directly (even inside an `as`
      // expression) trips `@typescript-eslint/unbound-method`, since the
      // rule looks at the ORIGINAL method-typed expression, not what it is
      // finally cast to. Nothing here ever CALLS these — `Reflector`/
      // `contextFor` only need them as an opaque key to read
      // `@RequirePermission` metadata off.
      const proto = PrintBatchController.prototype as unknown as Record<
        string,
        unknown
      >;
      const listHandler = proto.list as (...args: never[]) => unknown;
      const createHandler = proto.create as (...args: never[]) => unknown;

      // Sanity check on the raw read path `PermissionsGuard` itself calls,
      // before going through the guard — proves the SQL join
      // (user_roles → role_permissions → permissions) sees exactly this
      // one grant, no more.
      const grantedCodes = await userPermissions.getGrantedCodes(userId);
      expect(grantedCodes).toEqual(new Set(['print-batch:read']));

      const readGuard = new PermissionsGuard(reflector, userPermissions);
      await expect(
        readGuard.canActivate(
          contextFor(fixtureUser, listHandler, PrintBatchController),
        ),
      ).resolves.toBe(true);

      const createGuardBefore = new PermissionsGuard(
        reflector,
        userPermissions,
      );
      await expect(
        createGuardBefore.canActivate(
          contextFor(fixtureUser, createHandler, PrintBatchController),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // Grant print-batch:write on top of the existing print-batch:read —
      // `SetRolePermissionsCommand` is a full-replace (role.aggregate.ts's
      // own `setPermissions()`), so both codes must be listed together.
      await commandBus.execute(
        new SetRolePermissionsCommand(roleId, [
          'print-batch:read',
          'print-batch:write',
        ]),
      );

      const grantedCodesAfter = await userPermissions.getGrantedCodes(userId);
      expect(grantedCodesAfter).toEqual(
        new Set(['print-batch:read', 'print-batch:write']),
      );

      const createGuardAfter = new PermissionsGuard(reflector, userPermissions);
      await expect(
        createGuardAfter.canActivate(
          contextFor(fixtureUser, createHandler, PrintBatchController),
        ),
      ).resolves.toBe(true);
    } finally {
      // Cleanup — every fixture row this test created, regardless of
      // whether an assertion above failed.
      if (userId) {
        await commandBus.execute(new SetUserRolesCommand(userId, [], null));
      }
      if (roleId) {
        await commandBus.execute(new DeleteRoleCommand(roleId));
      }
      if (userId) {
        // No delete method on `IUserProfileRepository` (test-only cleanup,
        // not a business operation — see that interface's own doc comment
        // for why it never grew one) — a direct delete is the same thing
        // every other persistence spec in this codebase does for its own
        // fixture rows.
        await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
      }
    }

    // Confirm zero leftovers: role, role_permissions, user_roles, user.
    if (roleId) {
      const roleRows = await dataSource.query<unknown[]>(
        'SELECT 1 FROM roles WHERE id = $1',
        [roleId],
      );
      expect(roleRows).toHaveLength(0);
      const rolePermissionRows = await dataSource.query<unknown[]>(
        'SELECT 1 FROM role_permissions WHERE role_id = $1',
        [roleId],
      );
      expect(rolePermissionRows).toHaveLength(0);
    }
    if (userId) {
      const userRoleRows = await dataSource.query<unknown[]>(
        'SELECT 1 FROM user_roles WHERE user_id = $1',
        [userId],
      );
      expect(userRoleRows).toHaveLength(0);
      const userRows = await dataSource.query<unknown[]>(
        'SELECT 1 FROM users WHERE id = $1',
        [userId],
      );
      expect(userRows).toHaveLength(0);
    }
  });
});
