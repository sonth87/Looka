import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import { NotFoundException } from '@app/shared/errors/application.exception';
import { USER_PROFILE_REPOSITORY } from '../../../infrastructure/repositories/user-profile.repository.interface';
import type { IUserProfileRepository } from '../../../infrastructure/repositories/user-profile.repository.interface';
import { IDENTITY_ERROR_CODES } from '../../../identity.error-codes';
import { SetUserStatusCommand } from '../command/set-user-status.command';

/**
 * `status` only RECORDS disabled/active today — it is not yet enforced
 * anywhere (`SsoAuthGuard` still authenticates a disabled account's SSO
 * token normally, and `PermissionsGuard` does not check it). Wiring actual
 * enforcement is a follow-up once a real disable-in-anger case exists to
 * design the exact behaviour against (e.g. does a disabled admin keep the
 * `is_admin` fast path?).
 */
@CommandHandler(SetUserStatusCommand)
export class SetUserStatusHandler
  extends TransactionalCommandHandler<SetUserStatusCommand, { id: string }>
  implements ICommandHandler<SetUserStatusCommand, { id: string }>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(USER_PROFILE_REPOSITORY)
    private readonly users: IUserProfileRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: SetUserStatusCommand,
  ): Promise<{ id: string }> {
    const user = await this.users.findById(command.userId);
    if (!user) {
      throw new NotFoundException(
        IDENTITY_ERROR_CODES.USER_NOT_FOUND,
        'Không tìm thấy người dùng.',
      );
    }
    user.status = command.status;
    await this.users.save(user);
    return { id: user.id };
  }
}
