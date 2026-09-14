import { ICommand } from '@nestjs/cqrs';

export class RenameWorkflowCommand implements ICommand {
  constructor(
    public readonly workflowId: string,
    public readonly name: string,
    public readonly description: string | null | undefined,
  ) {}
}
