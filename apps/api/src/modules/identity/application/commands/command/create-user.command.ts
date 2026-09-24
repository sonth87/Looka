import { ICommand } from '@nestjs/cqrs';

export class CreateUserCommand implements ICommand {
  constructor(
    public readonly displayName: string,
    public readonly email: string,
    public readonly title: string | undefined,
    public readonly code: string | undefined,
    public readonly phone: string | undefined,
    public readonly department: string | undefined,
    public readonly faculty: string | undefined,
    public readonly roleIds: string[] | undefined,
    public readonly createdByUserId: string | null,
  ) {}
}
