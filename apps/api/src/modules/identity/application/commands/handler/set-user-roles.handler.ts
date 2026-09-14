import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import { ValidationException } from '@app/shared/errors/application.exception';
import { UserRoleAssignment } from '../../../domain/aggregate/user-role-assignment.aggregate';
import { ROLE_REPOSITORY } from '../../../infrastructure/repositories/role.repository.interface';
import type { IRoleRepository } from '../../../infrastructure/repositories/role.repository.interface';
import { USER_ROLE_ASSIGNMENT_REPOSITORY } from '../../../infrastructure/repositories/user-role-assignment.repository.interface';
import type { IUserRoleAssignmentRepository } from '../../../infrastructure/repositories/user-role-assignment.repository.interface';
import { IDENTITY_ERROR_CODES } from '../../../identity.error-codes';
import { SetUserRolesCommand } from '../command/set-user-roles.command';
import { SetUserRolesResult } from '../result/set-user-roles.result';

/**
 * Replace-all: diffs the requested `roleIds` against the account's current
 * assignments, revoking what's no longer wanted and granting what's new —
 * one transaction (`UnitOfWork.run()`, via the base class) either way.
 * Deliberately calls the two repositories directly rather than nesting
 * `CommandBus.execute()` on `AssignRoleToUserCommand`/`RevokeRole…`: a
 * nested command would open a second `UnitOfWork.run()`, and this
 * `UnitOfWork` does not support nested transactions (plan §4.2 — one use
 * case, one transaction).
 */
@CommandHandler(SetUserRolesCommand)
export class SetUserRolesHandler
  extends TransactionalCommandHandler<SetUserRolesCommand, SetUserRolesResult>
  implements ICommandHandler<SetUserRolesCommand, SetUserRolesResult>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
    @Inject(USER_ROLE_ASSIGNMENT_REPOSITORY)
    private readonly assignments: IUserRoleAssignmentRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: SetUserRolesCommand,
  ): Promise<SetUserRolesResult> {
    const wantedIds = [...new Set(command.roleIds)];
    const current = await this.assignments.listByUser(command.userId);
    const currentIds = new Set(current.map((a) => a.roleId));
    const wantedSet = new Set(wantedIds);

    const toRevoke = current.filter((a) => !wantedSet.has(a.roleId));
    const toAddIds = wantedIds.filter((id) => !currentIds.has(id));

    for (const assignment of toRevoke) {
      await this.assignments.revoke(command.userId, assignment.roleId);
    }

    const addedCodes: string[] = [];
    for (const roleId of toAddIds) {
      const role = await this.roles.findById(roleId);
      if (!role) {
        throw new ValidationException(
          IDENTITY_ERROR_CODES.ROLE_NOT_FOUND,
          `Mã vai trò không hợp lệ: ${roleId}.`,
        );
      }
      const result = UserRoleAssignment.create({
        userId: command.userId,
        roleId,
        roleCode: role.code,
        grantedByUserId: command.grantedByUserId,
      });
      await this.assignments.save(result.value);
      addedCodes.push(role.code);
    }

    const keptCodes = current
      .filter((a) => wantedSet.has(a.roleId))
      .map((a) => a.roleCode);

    return {
      userId: command.userId,
      roleCodes: [...new Set([...keptCodes, ...addedCodes])].sort(),
    };
  }
}
