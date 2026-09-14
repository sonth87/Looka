import { Injectable } from '@nestjs/common';
import { User } from '@app/modules/shared/entities/user.entity';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { IUserProfileRepository } from './user-profile.repository.interface';

@Injectable()
export class UserProfileRepository implements IUserProfileRepository {
  constructor(private readonly context: TransactionContext) {}

  findById(id: string): Promise<User | null> {
    return this.context.manager().findOneBy(User, { id });
  }

  findByCode(code: string): Promise<User | null> {
    return this.context.manager().findOneBy(User, { code });
  }

  save(user: User): Promise<User> {
    return this.context.manager().save(User, user);
  }
}
