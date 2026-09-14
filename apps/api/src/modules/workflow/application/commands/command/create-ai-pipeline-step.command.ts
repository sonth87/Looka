import { ICommand } from '@nestjs/cqrs';
import { CreateAiPipelineStepDto } from '../transfer-model/create-ai-pipeline-step.dto';

export class CreateAiPipelineStepCommand implements ICommand {
  constructor(public readonly dto: CreateAiPipelineStepDto) {}
}
