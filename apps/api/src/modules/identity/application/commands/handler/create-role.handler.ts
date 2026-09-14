import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import { BusinessRuleException } from '@app/shared/errors/application.exception';
import { Role } from '../../../domain/aggregate/role.aggregate';
import { ROLE_REPOSITORY } from '../../../infrastructure/repositories/role.repository.interface';
import type { IRoleRepository } from '../../../infrastructure/repositories/role.repository.interface';
import { IDENTITY_ERROR_CODES } from '../../../identity.error-codes';
import { CreateRoleCommand } from '../command/create-role.command';
import { RoleResult } from '../result/role.result';

@CommandHandler(CreateRoleCommand)
export class CreateRoleHandler
  extends TransactionalCommandHandler<CreateRoleCommand, RoleResult>
  implements ICommandHandler<CreateRoleCommand, RoleResult>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(command: CreateRoleCommand): Promise<RoleResult> {
    const result = Role.create({
      code: command.code,
      name: command.name,
      description: command.description,
    });
    if (result.isFailure) {
      throw new BusinessRuleException(
        IDENTITY_ERROR_CODES.ROLE_VALIDATION_FAILED,
        result.error,
      );
    }

    const role = result.value;
    await this.roles.save(role);

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
