import { IQuery } from '@nestjs/cqrs';

export class GetWorkflowUsageQuery implements IQuery {
  constructor(public readonly workflowId: string) {}
}
