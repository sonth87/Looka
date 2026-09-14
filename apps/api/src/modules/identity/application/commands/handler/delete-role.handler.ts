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
import { DeleteRoleCommand } from '../command/delete-role.command';

@CommandHandler(DeleteRoleCommand)
export class DeleteRoleHandler
  extends TransactionalCommandHandler<DeleteRoleCommand, { id: string }>
  implements ICommandHandler<DeleteRoleCommand, { id: string }>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(command: DeleteRoleCommand): Promise<{ id: string }> {
    const role = await this.roles.findById(command.roleId);
    if (!role) {
      throw new NotFoundException(
        IDENTITY_ERROR_CODES.ROLE_NOT_FOUND,
        'Không tìm thấy vai trò.',
      );
    }
    if (role.isSystem) {
      throw new BusinessRuleException(
        IDENTITY_ERROR_CODES.ROLE_IS_SYSTEM,
        `Vai trò hệ thống "${role.code}" không thể xóa.`,
      );
    }

    await this.roles.delete(role.id);
    return { id: role.id };
  }
}
