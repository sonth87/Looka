import { ICommand } from '@nestjs/cqrs';
import type { WorkflowConfig } from '../../../domain/schema/workflow-config.schema';

export class CreateWorkflowCommand implements ICommand {
  constructor(
    public readonly code: string,
    public readonly name: string,
    public readonly description: string | undefined,
    public readonly config: WorkflowConfig,
    public readonly createdByUserId: string | null,
  ) {}
}
