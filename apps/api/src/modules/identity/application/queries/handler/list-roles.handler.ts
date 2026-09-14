import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { RoleCatalogReadRepository } from '../../../infrastructure/read/role-catalog.read-repository';
import { RoleReadModel } from '../read-model/role.read-model';
import { ListRolesQuery } from '../query/list-roles.query';

@QueryHandler(ListRolesQuery)
export class ListRolesHandler implements IQueryHandler<
  ListRolesQuery,
  RoleReadModel[]
> {
  constructor(private readonly repository: RoleCatalogReadRepository) {}

  execute(): Promise<RoleReadModel[]> {
    return this.repository.list();
  }
}
