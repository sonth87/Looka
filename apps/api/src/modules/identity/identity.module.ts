import { Module, OnModuleInit } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { ConstraintErrorTranslator } from '@app/shared/database/constraint-error.translator';
import { ErrorCodeRegistry } from '@app/shared/errors/error-code.registry';
import { ConflictException } from '@app/shared/errors/application.exception';
import { PermissionEntity } from './infrastructure/persistence/permission.entity';
import { RoleEntity } from './infrastructure/persistence/role.entity';
import { RolePermissionEntity } from './infrastructure/persistence/role-permission.entity';
import { UserRoleEntity } from './infrastructure/persistence/user-role.entity';
import { ROLE_REPOSITORY } from './infrastructure/repositories/role.repository.interface';
import { RoleRepository } from './infrastructure/repositories/role.repository';
import { USER_ROLE_ASSIGNMENT_REPOSITORY } from './infrastructure/repositories/user-role-assignment.repository.interface';
import { UserRoleAssignmentRepository } from './infrastructure/repositories/user-role-assignment.repository';
import { USER_PROFILE_REPOSITORY } from './infrastructure/repositories/user-profile.repository.interface';
import { UserProfileRepository } from './infrastructure/repositories/user-profile.repository';
import { RoleCatalogReadRepository } from './infrastructure/read/role-catalog.read-repository';
import { PermissionCatalogReadRepository } from './infrastructure/read/permission-catalog.read-repository';
import { UserPermissionReadRepository } from './infrastructure/read/user-permission.read-repository';
import { UserDirectoryReadRepository } from './infrastructure/read/user-directory.read-repository';
import { USER_DIRECTORY_CLIENT } from './application/ports/user-directory.port';
import { UserDirectoryClient } from './infrastructure/integrations/user-directory.client';
import { UserDirectorySyncService } from './application/user-directory-sync.service';
import { PermissionCatalogService } from './application/permission-catalog.service';
import { CreateRoleHandler } from './application/commands/handler/create-role.handler';
import { RenameRoleHandler } from './application/commands/handler/rename-role.handler';
import { SetRolePermissionsHandler } from './application/commands/handler/set-role-permissions.handler';
import { DeleteRoleHandler } from './application/commands/handler/delete-role.handler';
import { SetUserRolesHandler } from './application/commands/handler/set-user-roles.handler';
import { CreateUserHandler } from './application/commands/handler/create-user.handler';
import { UpdateUserProfileHandler } from './application/commands/handler/update-user-profile.handler';
import { SetUserStatusHandler } from './application/commands/handler/set-user-status.handler';
import { SetUserAvatarHandler } from './application/commands/handler/set-user-avatar.handler';
import { SyncUsersHandler } from './application/commands/handler/sync-users.handler';
import { ListRolesHandler } from './application/queries/handler/list-roles.handler';
import { GetRoleHandler } from './application/queries/handler/get-role.handler';
import { ListPermissionsHandler } from './application/queries/handler/list-permissions.handler';
import { GetMePermissionsHandler } from './application/queries/handler/get-me-permissions.handler';
import { ListUsersHandler } from './application/queries/handler/list-users.handler';
import { GetUserHandler } from './application/queries/handler/get-user.handler';
import { ListRoleUsersHandler } from './application/queries/handler/list-role-users.handler';
import { GetUserSyncStatusHandler } from './application/queries/handler/get-user-sync-status.handler';
import { PermissionsGuard } from './presentation/guards/permissions.guard';
import { RoleCommandController } from './presentation/cms/role.command.controller';
import { RoleQueryController } from './presentation/cms/role.query.controller';
import { PermissionQueryController } from './presentation/cms/permission.query.controller';
import { UserRoleCommandController } from './presentation/cms/user-role.command.controller';
import { MePermissionQueryController } from './presentation/cms/me-permission.query.controller';
import { UserCommandController } from './presentation/cms/user.command.controller';
import { UserQueryController } from './presentation/cms/user.query.controller';
import {
  IDENTITY_CONSTRAINTS,
  IDENTITY_ERROR_CODES,
} from './identity.error-codes';

const COMMAND_HANDLERS = [
  CreateRoleHandler,
  RenameRoleHandler,
  SetRolePermissionsHandler,
  DeleteRoleHandler,
  SetUserRolesHandler,
  CreateUserHandler,
  UpdateUserProfileHandler,
  SetUserStatusHandler,
  SetUserAvatarHandler,
  SyncUsersHandler,
];

const QUERY_HANDLERS = [
  ListRolesHandler,
  GetRoleHandler,
  ListPermissionsHandler,
  GetMePermissionsHandler,
  ListUsersHandler,
  GetUserHandler,
  ListRoleUsersHandler,
  GetUserSyncStatusHandler,
];

/**
 * RBAC + user management for the CMS 8-screens plan
 * (docs/plans/cms-8-screens-api-plan.md §2.8/P1), built as the first
 * module under the target structure from
 * docs/plans/backend-layering-plan.md §3/§7 Q11 ("module mới viết theo cấu
 * trúc mới ngay" / "rbac … đặt ở modules/identity"). Not yet split into
 * `identity-command.module.ts`/`identity-query.module.ts`/
 * `identity-worker.module.ts` — no business module has made that split
 * yet either (roadmap §6 Giai đoạn 1 is still pending), so this one module
 * is imported wholesale into all four root modules, matching
 * `CaptureModule`/`DeviceManagementModule`/`PhotoReviewModule` today. It
 * has no worker (no `@Cron`), so importing it into `app-worker.module.ts`
 * only costs DI wiring, not an idle cron slot.
 *
 * Deliberately does NOT yet own the existing `users` table/entity — that
 * extraction (out of `SsoAuthGuard`) is roadmap Giai đoạn 3, a separate,
 * larger, higher-risk move. This module DOES now read/write that table's
 * rows (Users CRUD, directory sync) via `UserProfileRepository`/
 * `UserDirectoryReadRepository` — see those files' own doc comments for
 * why that is a deliberate, documented simplification rather than an
 * aggregate. `user_roles.user_id` and `SetUserRolesCommand`'s target both
 * reference `users.id` by bare uuid, relying on the FK constraint (not a
 * cross-module TypeORM relation) for referential integrity — the same
 * convention `campaign_members.user_id` already uses.
 */
@Module({
  imports: [
    CqrsModule,
    // `PermissionCatalogService` needs `DiscoveryService`/`MetadataScanner`
    // — `FoundationModule` also imports `DiscoveryModule` (for
    // `DomainEventDispatcher`), but only for its OWN internal use; it does
    // not re-export `DiscoveryService`/`MetadataScanner` in its `exports`
    // array, so being `@Global()` does not make those available here too.
    // Confirmed live: boot failed with `UnknownDependenciesException` for
    // `DiscoveryService` before this import was added.
    DiscoveryModule,
    ConfigModule,
    // For `UserCommandController`'s avatar upload — see that controller's
    // own doc comment on why it uploads synchronously rather than through
    // the outbox+worker pattern.
    FileStorageModule,
    TypeOrmModule.forFeature([
      RoleEntity,
      PermissionEntity,
      RolePermissionEntity,
      UserRoleEntity,
    ]),
  ],
  controllers: [
    RoleCommandController,
    RoleQueryController,
    PermissionQueryController,
    UserRoleCommandController,
    MePermissionQueryController,
    UserCommandController,
    UserQueryController,
  ],
  providers: [
    { provide: ROLE_REPOSITORY, useClass: RoleRepository },
    {
      provide: USER_ROLE_ASSIGNMENT_REPOSITORY,
      useClass: UserRoleAssignmentRepository,
    },
    { provide: USER_PROFILE_REPOSITORY, useClass: UserProfileRepository },
    { provide: USER_DIRECTORY_CLIENT, useClass: UserDirectoryClient },
    RoleCatalogReadRepository,
    PermissionCatalogReadRepository,
    UserPermissionReadRepository,
    UserDirectoryReadRepository,
    UserDirectorySyncService,
    PermissionCatalogService,
    PermissionsGuard,
    ...COMMAND_HANDLERS,
    ...QUERY_HANDLERS,
  ],
  // `PermissionsGuard` is exported so any other module can put
  // `@UseGuards(PermissionsGuard)` + `@RequirePermission(...)` on its own
  // controllers (see device-management's campaign.controller.ts for the
  // first caller) — that module must add `IdentityModule` to its own
  // `imports` for Nest's DI to resolve the guard there.
  //
  // `UserPermissionReadRepository` must ALSO be exported: confirmed live
  // that `@UseGuards(PermissionsGuard)` resolves the guard's constructor
  // params against the CONSUMING module's own DI graph, not a
  // pre-instantiated singleton carried over from `IdentityModule` — the
  // boot failed with `UnknownDependenciesException` for this provider from
  // `DeviceManagementModule` (which imports `IdentityModule` and can see
  // `PermissionsGuard` itself, but not what the guard depends on
  // internally) until this was added.
  exports: [PermissionsGuard, UserPermissionReadRepository],
})
export class IdentityModule implements OnModuleInit {
  constructor(
    private readonly errorCodes: ErrorCodeRegistry,
    private readonly constraintTranslator: ConstraintErrorTranslator,
  ) {}

  onModuleInit(): void {
    this.errorCodes.register('identity', IDENTITY_ERROR_CODES);
    this.constraintTranslator.register(
      IDENTITY_CONSTRAINTS.ROLE_CODE_UNIQUE,
      () =>
        new ConflictException(
          IDENTITY_ERROR_CODES.ROLE_CODE_TAKEN,
          'Mã vai trò đã tồn tại.',
        ),
    );
    this.constraintTranslator.register(
      IDENTITY_CONSTRAINTS.USER_CODE_UNIQUE,
      () =>
        new ConflictException(
          IDENTITY_ERROR_CODES.USER_CODE_TAKEN,
          'Mã nội bộ đã tồn tại.',
        ),
    );
  }
}
