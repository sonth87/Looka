import { ICommand } from '@nestjs/cqrs';

export class UpdateUserProfileCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly displayName: string | undefined,
    public readonly title: string | undefined,
    public readonly code: string | undefined,
    public readonly phone: string | undefined,
    public readonly department: string | undefined,
    public readonly faculty: string | undefined,
  ) {}
}
