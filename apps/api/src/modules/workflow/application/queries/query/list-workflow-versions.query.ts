import { IQuery } from '@nestjs/cqrs';

export class ListWorkflowVersionsQuery implements IQuery {
  constructor(public readonly workflowId: string) {}
}
