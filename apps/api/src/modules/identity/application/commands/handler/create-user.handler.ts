import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { User } from '@app/modules/shared/entities/user.entity';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import { ValidationException } from '@app/shared/errors/application.exception';
import { UserRoleAssignment } from '../../../domain/aggregate/user-role-assignment.aggregate';
import { ROLE_REPOSITORY } from '../../../infrastructure/repositories/role.repository.interface';
import type { IRoleRepository } from '../../../infrastructure/repositories/role.repository.interface';
import { USER_PROFILE_REPOSITORY } from '../../../infrastructure/repositories/user-profile.repository.interface';
import type { IUserProfileRepository } from '../../../infrastructure/repositories/user-profile.repository.interface';
import { USER_ROLE_ASSIGNMENT_REPOSITORY } from '../../../infrastructure/repositories/user-role-assignment.repository.interface';
import type { IUserRoleAssignmentRepository } from '../../../infrastructure/repositories/user-role-assignment.repository.interface';
import { IDENTITY_ERROR_CODES } from '../../../identity.error-codes';
import { CreateUserCommand } from '../command/create-user.command';

/**
 * Adds a person by hand ("thêm người dùng" — cms-8-screens-api-plan.md
 * §2.8), independent of any SSO login. `User` has no domain aggregate yet
 * (see `user-profile.repository.ts`'s own doc comment), so this handler
 * builds the entity directly rather than through an aggregate factory —
 * an accepted, documented simplification for this pass.
 *
 * `sso_user_code` is `NOT NULL UNIQUE` on the existing `users` table
 * (`1791000000000-CreateUsers.ts`), so a manually-added person — who has
 * no SSO code yet — gets a synthetic `MANUAL:<uuid>` placeholder.
 * `SsoAuthGuard.upsertUser()` merges this row into the person's real
 * identity (keeping every role/permission already granted here) the first
 * time they actually log in via SSO under the same email — see that
 * guard's own doc comment for the merge rule (2026-09-14, previously a
 * documented gap deferred out of P1 specifically because that guard is
 * security-critical with its own dedicated test suite).
 */
@CommandHandler(CreateUserCommand)
export class CreateUserHandler
  extends TransactionalCommandHandler<CreateUserCommand, { id: string }>
  implements ICommandHandler<CreateUserCommand, { id: string }>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(USER_PROFILE_REPOSITORY)
    private readonly users: IUserProfileRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
    @Inject(USER_ROLE_ASSIGNMENT_REPOSITORY)
    private readonly assignments: IUserRoleAssignmentRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(command: CreateUserCommand): Promise<{ id: string }> {
    if (command.code) {
      const existing = await this.users.findByCode(command.code);
      if (existing) {
        throw new ValidationException(
          IDENTITY_ERROR_CODES.ROLE_VALIDATION_FAILED,
          `Mã nội bộ "${command.code}" đã được dùng.`,
        );
      }
    }

    const user = new User();
    user.ssoUserCode = `MANUAL:${randomUUID()}`;
    user.email = command.email;
    user.displayName = command.displayName;
    user.title = command.title ?? null;
    user.code = command.code ?? null;
    user.phone = command.phone ?? null;
    user.isAdmin = false;
    user.roles = [];
    user.status = 'ACTIVE';
    user.source = 'MANUAL';
    const saved = await this.users.save(user);

    for (const roleId of new Set(command.roleIds ?? [])) {
      const role = await this.roles.findById(roleId);
      if (!role) {
        throw new ValidationException(
          IDENTITY_ERROR_CODES.ROLE_NOT_FOUND,
          `Mã vai trò không hợp lệ: ${roleId}.`,
        );
      }
      const assignment = UserRoleAssignment.create({
        userId: saved.id,
        roleId,
        roleCode: role.code,
        grantedByUserId: command.createdByUserId,
      });
      await this.assignments.save(assignment.value);
    }

    return { id: saved.id };
  }
}
