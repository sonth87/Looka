import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import { NotFoundException } from '@app/shared/errors/application.exception';
import { USER_PROFILE_REPOSITORY } from '../../../infrastructure/repositories/user-profile.repository.interface';
import type { IUserProfileRepository } from '../../../infrastructure/repositories/user-profile.repository.interface';
import { IDENTITY_ERROR_CODES } from '../../../identity.error-codes';
import { SetUserAvatarCommand } from '../command/set-user-avatar.command';

@CommandHandler(SetUserAvatarCommand)
export class SetUserAvatarHandler
  extends TransactionalCommandHandler<
    SetUserAvatarCommand,
    { id: string; avatarFsFileId: string }
  >
  implements
    ICommandHandler<
      SetUserAvatarCommand,
      { id: string; avatarFsFileId: string }
    >
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(USER_PROFILE_REPOSITORY)
    private readonly users: IUserProfileRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: SetUserAvatarCommand,
  ): Promise<{ id: string; avatarFsFileId: string }> {
    const user = await this.users.findById(command.userId);
    if (!user) {
      throw new NotFoundException(
        IDENTITY_ERROR_CODES.USER_NOT_FOUND,
        'Không tìm thấy người dùng.',
      );
    }
    user.avatarFsFileId = command.fsFileId;
    await this.users.save(user);
    return { id: user.id, avatarFsFileId: command.fsFileId };
  }
}
