import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Pagination } from '@app/shared/http/pagination';
import { UserDirectoryReadRepository } from '../../../infrastructure/read/user-directory.read-repository';
import { UserReadModel } from '../read-model/user.read-model';
import { ListRoleUsersQuery } from '../query/list-role-users.query';

@QueryHandler(ListRoleUsersQuery)
export class ListRoleUsersHandler implements IQueryHandler<
  ListRoleUsersQuery,
  Pagination<UserReadModel>
> {
  constructor(private readonly repository: UserDirectoryReadRepository) {}

  execute(query: ListRoleUsersQuery): Promise<Pagination<UserReadModel>> {
    return this.repository.listByRole(query.roleId, query.page, query.limit);
  }
}
