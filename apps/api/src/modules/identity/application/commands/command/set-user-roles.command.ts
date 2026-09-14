import { ICommand } from '@nestjs/cqrs';

/** Replace-all semantics per cms-8-screens-api-plan.md §2.8: `PUT /v1/users/:id/roles {roleIds}`. */
export class SetUserRolesCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly roleIds: string[],
    public readonly grantedByUserId: string | null,
  ) {}
}
