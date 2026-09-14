import { ICommand } from '@nestjs/cqrs';

export class PublishWorkflowCommand implements ICommand {
  constructor(
    public readonly workflowId: string,
    public readonly publishedByUserId: string | null,
  ) {}
}
