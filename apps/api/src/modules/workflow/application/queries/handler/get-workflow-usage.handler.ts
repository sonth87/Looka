import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { WorkflowCatalogReadRepository } from '../../../infrastructure/read/workflow-catalog.read-repository';
import { WorkflowUsageReadModel } from '../read-model/workflow.read-model';
import { GetWorkflowUsageQuery } from '../query/get-workflow-usage.query';

@QueryHandler(GetWorkflowUsageQuery)
export class GetWorkflowUsageHandler implements IQueryHandler<
  GetWorkflowUsageQuery,
  WorkflowUsageReadModel[]
> {
  constructor(private readonly repository: WorkflowCatalogReadRepository) {}

  execute(query: GetWorkflowUsageQuery): Promise<WorkflowUsageReadModel[]> {
    return this.repository.usage(query.workflowId);
  }
}
