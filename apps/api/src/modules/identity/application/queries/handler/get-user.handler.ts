import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { UserDirectoryReadRepository } from '../../../infrastructure/read/user-directory.read-repository';
import { UserReadModel } from '../read-model/user.read-model';
import { GetUserQuery } from '../query/get-user.query';

@QueryHandler(GetUserQuery)
export class GetUserHandler implements IQueryHandler<
  GetUserQuery,
  UserReadModel
> {
  constructor(private readonly repository: UserDirectoryReadRepository) {}

  async execute(query: GetUserQuery): Promise<UserReadModel> {
    const user = await this.repository.getById(query.userId);
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng.');
    }
    return user;
  }
}
