import { ICommand } from '@nestjs/cqrs';

export class RenameRoleCommand implements ICommand {
  constructor(
    public readonly roleId: string,
    public readonly name: string,
    public readonly description: string | null | undefined,
  ) {}
}
