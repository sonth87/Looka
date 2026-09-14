import { ICommand } from '@nestjs/cqrs';

export class DeleteWorkflowCommand implements ICommand {
  constructor(public readonly workflowId: string) {}
}
