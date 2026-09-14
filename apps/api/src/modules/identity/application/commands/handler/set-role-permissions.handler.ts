import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import {
  NotFoundException,
  ValidationException,
} from '@app/shared/errors/application.exception';
import { ROLE_REPOSITORY } from '../../../infrastructure/repositories/role.repository.interface';
import type { IRoleRepository } from '../../../infrastructure/repositories/role.repository.interface';
import { PermissionCatalogReadRepository } from '../../../infrastructure/read/permission-catalog.read-repository';
import { IDENTITY_ERROR_CODES } from '../../../identity.error-codes';
import { SetRolePermissionsCommand } from '../command/set-role-permissions.command';
import { RoleResult } from '../result/role.result';

@CommandHandler(SetRolePermissionsCommand)
export class SetRolePermissionsHandler
  extends TransactionalCommandHandler<SetRolePermissionsCommand, RoleResult>
  implements ICommandHandler<SetRolePermissionsCommand, RoleResult>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
    private readonly permissionCatalog: PermissionCatalogReadRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: SetRolePermissionsCommand,
  ): Promise<RoleResult> {
    const role = await this.roles.findById(command.roleId);
    if (!role) {
      throw new NotFoundException(
        IDENTITY_ERROR_CODES.ROLE_NOT_FOUND,
        'Không tìm thấy vai trò.',
      );
    }

    const wantedCodes = [...new Set(command.permissionCodes)];
    if (wantedCodes.length > 0) {
      const knownIds = await this.permissionCatalog.findIdsByCode(wantedCodes);
      if (knownIds.length !== wantedCodes.length) {
        throw new ValidationException(
          IDENTITY_ERROR_CODES.UNKNOWN_PERMISSION_CODE,
          'Một hoặc nhiều mã quyền không tồn tại trong catalog.',
        );
      }
    }

    const result = role.setPermissions(wantedCodes);
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
