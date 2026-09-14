import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Pagination } from '@app/shared/http/pagination';
import { WorkflowCatalogReadRepository } from '../../../infrastructure/read/workflow-catalog.read-repository';
import { WorkflowReadModel } from '../read-model/workflow.read-model';
import { ListWorkflowsQuery } from '../query/list-workflows.query';

@QueryHandler(ListWorkflowsQuery)
export class ListWorkflowsHandler implements IQueryHandler<
  ListWorkflowsQuery,
  Pagination<WorkflowReadModel>
> {
  constructor(private readonly repository: WorkflowCatalogReadRepository) {}

  execute(query: ListWorkflowsQuery): Promise<Pagination<WorkflowReadModel>> {
    return this.repository.list(query.filter);
  }
}
