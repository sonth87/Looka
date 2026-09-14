import { ICommand } from '@nestjs/cqrs';

export class CreateWorkflowDraftVersionCommand implements ICommand {
  constructor(public readonly workflowId: string) {}
}
