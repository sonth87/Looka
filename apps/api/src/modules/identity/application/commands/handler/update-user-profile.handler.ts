import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import {
  NotFoundException,
  ValidationException,
} from '@app/shared/errors/application.exception';
import { USER_PROFILE_REPOSITORY } from '../../../infrastructure/repositories/user-profile.repository.interface';
import type { IUserProfileRepository } from '../../../infrastructure/repositories/user-profile.repository.interface';
import { IDENTITY_ERROR_CODES } from '../../../identity.error-codes';
import { UpdateUserProfileCommand } from '../command/update-user-profile.command';

@CommandHandler(UpdateUserProfileCommand)
export class UpdateUserProfileHandler
  extends TransactionalCommandHandler<UpdateUserProfileCommand, { id: string }>
  implements ICommandHandler<UpdateUserProfileCommand, { id: string }>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(USER_PROFILE_REPOSITORY)
    private readonly users: IUserProfileRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: UpdateUserProfileCommand,
  ): Promise<{ id: string }> {
    const user = await this.users.findById(command.userId);
    if (!user) {
      throw new NotFoundException(
        IDENTITY_ERROR_CODES.USER_NOT_FOUND,
        'Không tìm thấy người dùng.',
      );
    }

    if (command.code !== undefined && command.code !== user.code) {
      const existing = await this.users.findByCode(command.code);
      if (existing && existing.id !== user.id) {
        throw new ValidationException(
          IDENTITY_ERROR_CODES.ROLE_VALIDATION_FAILED,
          `Mã nội bộ "${command.code}" đã được dùng.`,
        );
      }
      user.code = command.code;
    }
    if (command.displayName !== undefined)
      user.displayName = command.displayName;
    if (command.title !== undefined) user.title = command.title;
    if (command.phone !== undefined) user.phone = command.phone;

    await this.users.save(user);
    return { id: user.id };
  }
}
