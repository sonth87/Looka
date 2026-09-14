import { IQuery } from '@nestjs/cqrs';
import { ListWorkflowsFilter } from '../../../infrastructure/read/workflow-catalog.read-repository';

export class ListWorkflowsQuery implements IQuery {
  constructor(public readonly filter: ListWorkflowsFilter) {}
}
