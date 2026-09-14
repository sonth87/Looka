import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { WorkflowCatalogReadRepository } from '../../../infrastructure/read/workflow-catalog.read-repository';
import { WorkflowVersionSummary } from '../read-model/workflow.read-model';
import { ListWorkflowVersionsQuery } from '../query/list-workflow-versions.query';

@QueryHandler(ListWorkflowVersionsQuery)
export class ListWorkflowVersionsHandler implements IQueryHandler<
  ListWorkflowVersionsQuery,
  WorkflowVersionSummary[]
> {
  constructor(private readonly repository: WorkflowCatalogReadRepository) {}

  execute(query: ListWorkflowVersionsQuery): Promise<WorkflowVersionSummary[]> {
    return this.repository.listVersions(query.workflowId);
  }
}
