import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { WorkflowCatalogReadRepository } from '../../../infrastructure/read/workflow-catalog.read-repository';
import { WorkflowReadModel } from '../read-model/workflow.read-model';
import { GetWorkflowQuery } from '../query/get-workflow.query';

@QueryHandler(GetWorkflowQuery)
export class GetWorkflowHandler implements IQueryHandler<
  GetWorkflowQuery,
  WorkflowReadModel
> {
  constructor(private readonly repository: WorkflowCatalogReadRepository) {}

  async execute(query: GetWorkflowQuery): Promise<WorkflowReadModel> {
    const workflow = await this.repository.getById(query.workflowId);
    if (!workflow) {
      throw new NotFoundException('Không tìm thấy nghiệp vụ.');
    }
    return workflow;
  }
}
