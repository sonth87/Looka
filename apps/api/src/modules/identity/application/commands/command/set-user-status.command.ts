import { ICommand } from '@nestjs/cqrs';

export class SetUserStatusCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly status: 'ACTIVE' | 'DISABLED',
  ) {}
}
