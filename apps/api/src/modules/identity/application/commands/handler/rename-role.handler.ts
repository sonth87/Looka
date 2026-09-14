import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import {
  BusinessRuleException,
  NotFoundException,
} from '@app/shared/errors/application.exception';
import { ROLE_REPOSITORY } from '../../../infrastructure/repositories/role.repository.interface';
import type { IRoleRepository } from '../../../infrastructure/repositories/role.repository.interface';
import { IDENTITY_ERROR_CODES } from '../../../identity.error-codes';
import { RenameRoleCommand } from '../command/rename-role.command';
import { RoleResult } from '../result/role.result';

@CommandHandler(RenameRoleCommand)
export class RenameRoleHandler
  extends TransactionalCommandHandler<RenameRoleCommand, RoleResult>
  implements ICommandHandler<RenameRoleCommand, RoleResult>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(command: RenameRoleCommand): Promise<RoleResult> {
    const role = await this.roles.findById(command.roleId);
    if (!role) {
      throw new NotFoundException(
        IDENTITY_ERROR_CODES.ROLE_NOT_FOUND,
        'Không tìm thấy vai trò.',
      );
    }

    const result = role.rename(command.name, command.description);
    if (result.isFailure) {
      throw new BusinessRuleException(
        IDENTITY_ERROR_CODES.ROLE_VALIDATION_FAILED,
        result.error,
      );
    }
    if (!result.isNoop) {
      await this.roles.save(role);
    }

    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissionCodes: [...role.permissionCodes],
    };
  }
}
