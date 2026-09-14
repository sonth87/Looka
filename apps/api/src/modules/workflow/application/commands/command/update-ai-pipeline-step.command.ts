import { ICommand } from '@nestjs/cqrs';
import { UpdateAiPipelineStepDto } from '../transfer-model/update-ai-pipeline-step.dto';

export class UpdateAiPipelineStepCommand implements ICommand {
  constructor(
    public readonly stepId: string,
    public readonly dto: UpdateAiPipelineStepDto,
  ) {}
}
