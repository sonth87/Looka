import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Pagination } from '@app/shared/http/pagination';
import { UserDirectoryReadRepository } from '../../../infrastructure/read/user-directory.read-repository';
import { UserReadModel } from '../read-model/user.read-model';
import { ListUsersQuery } from '../query/list-users.query';

@QueryHandler(ListUsersQuery)
export class ListUsersHandler implements IQueryHandler<
  ListUsersQuery,
  Pagination<UserReadModel>
> {
  constructor(private readonly repository: UserDirectoryReadRepository) {}

  execute(query: ListUsersQuery): Promise<Pagination<UserReadModel>> {
    return this.repository.list(query.filter);
  }
}
