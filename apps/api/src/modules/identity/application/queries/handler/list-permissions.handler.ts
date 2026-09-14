import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PermissionCatalogReadRepository } from '../../../infrastructure/read/permission-catalog.read-repository';
import { PermissionReadModel } from '../read-model/permission.read-model';
import { ListPermissionsQuery } from '../query/list-permissions.query';

@QueryHandler(ListPermissionsQuery)
export class ListPermissionsHandler implements IQueryHandler<
  ListPermissionsQuery,
  PermissionReadModel[]
> {
  constructor(private readonly repository: PermissionCatalogReadRepository) {}

  execute(): Promise<PermissionReadModel[]> {
    return this.repository.list();
  }
}
