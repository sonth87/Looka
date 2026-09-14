import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { UserPermissionReadRepository } from '../../../infrastructure/read/user-permission.read-repository';
import { MePermissionsReadModel } from '../read-model/me-permissions.read-model';
import { GetMePermissionsQuery } from '../query/get-me-permissions.query';

@QueryHandler(GetMePermissionsQuery)
export class GetMePermissionsHandler implements IQueryHandler<
  GetMePermissionsQuery,
  MePermissionsReadModel
> {
  constructor(private readonly repository: UserPermissionReadRepository) {}

  async execute(query: GetMePermissionsQuery): Promise<MePermissionsReadModel> {
    const roleCodes = await this.repository.getRoleCodes(query.userId);
    // An admin implicitly has every permission (permissions.guard.ts's own
    // fast-path) — returning the full granted-codes set for an admin would
    // just be every row in the catalog, which is not useful for the CMS's
    // "show/hide nav items" use case, so it stays empty per the read-model's
    // own doc comment.
    const permissionCodes = query.isAdmin
      ? []
      : [...(await this.repository.getGrantedCodes(query.userId))].sort();

    return { isAdmin: query.isAdmin, roleCodes, permissionCodes };
  }
}
