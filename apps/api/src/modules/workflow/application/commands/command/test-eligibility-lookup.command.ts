import { ICommand } from '@nestjs/cqrs';

export class TestEligibilityLookupCommand implements ICommand {
  constructor(
    public readonly clientCode: string,
    public readonly key: string,
  ) {}
}
