import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import { AiPipelineStepEntity } from '../../../infrastructure/persistence/ai-pipeline-step.entity';
import { AI_PIPELINE_STEP_REPOSITORY } from '../../../infrastructure/repositories/ai-pipeline-step.repository.interface';
import type { IAiPipelineStepRepository } from '../../../infrastructure/repositories/ai-pipeline-step.repository.interface';
import { CreateAiPipelineStepCommand } from '../command/create-ai-pipeline-step.command';

@CommandHandler(CreateAiPipelineStepCommand)
export class CreateAiPipelineStepHandler
  extends TransactionalCommandHandler<
    CreateAiPipelineStepCommand,
    { id: string }
  >
  implements ICommandHandler<CreateAiPipelineStepCommand, { id: string }>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(AI_PIPELINE_STEP_REPOSITORY)
    private readonly steps: IAiPipelineStepRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: CreateAiPipelineStepCommand,
  ): Promise<{ id: string }> {
    const entity = new AiPipelineStepEntity();
    entity.code = command.dto.code.trim().toUpperCase();
    entity.nameVi = command.dto.nameVi;
    entity.description = command.dto.description ?? null;
    entity.sidecarEndpoint = command.dto.sidecarEndpoint;
    entity.paramsSchema = command.dto.paramsSchema ?? null;
    entity.defaultParams = command.dto.defaultParams ?? null;
    entity.active = command.dto.active ?? true;
    entity.sortOrder = command.dto.sortOrder ?? 0;
    entity.isSystem = false;
    const saved = await this.steps.save(entity);
    return { id: saved.id };
  }
}
