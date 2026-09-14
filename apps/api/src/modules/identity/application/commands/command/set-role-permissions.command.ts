import { ICommand } from '@nestjs/cqrs';

export class SetRolePermissionsCommand implements ICommand {
  constructor(
    public readonly roleId: string,
    public readonly permissionCodes: string[],
  ) {}
}
