import { IQuery } from '@nestjs/cqrs';

export class GetWorkflowQuery implements IQuery {
  constructor(public readonly workflowId: string) {}
}
