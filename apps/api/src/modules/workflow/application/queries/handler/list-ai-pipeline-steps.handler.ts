import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { AiPipelineStepReadRepository } from '../../../infrastructure/read/ai-pipeline-step.read-repository';
import { AiPipelineStepReadModel } from '../read-model/ai-pipeline-step.read-model';
import { ListAiPipelineStepsQuery } from '../query/list-ai-pipeline-steps.query';

@QueryHandler(ListAiPipelineStepsQuery)
export class ListAiPipelineStepsHandler implements IQueryHandler<
  ListAiPipelineStepsQuery,
  AiPipelineStepReadModel[]
> {
  constructor(private readonly repository: AiPipelineStepReadRepository) {}

  execute(query: ListAiPipelineStepsQuery): Promise<AiPipelineStepReadModel[]> {
    return this.repository.list(query.includeInactive);
  }
}
