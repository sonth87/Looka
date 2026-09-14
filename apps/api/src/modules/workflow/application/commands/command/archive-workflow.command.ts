import { ICommand } from '@nestjs/cqrs';

export class ArchiveWorkflowCommand implements ICommand {
  constructor(public readonly workflowId: string) {}
}
