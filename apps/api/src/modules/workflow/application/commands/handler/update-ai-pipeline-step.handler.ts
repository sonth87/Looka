import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import { NotFoundException } from '@app/shared/errors/application.exception';
import { AI_PIPELINE_STEP_REPOSITORY } from '../../../infrastructure/repositories/ai-pipeline-step.repository.interface';
import type { IAiPipelineStepRepository } from '../../../infrastructure/repositories/ai-pipeline-step.repository.interface';
import { WORKFLOW_ERROR_CODES } from '../../../workflow.error-codes';
import { UpdateAiPipelineStepCommand } from '../command/update-ai-pipeline-step.command';

@CommandHandler(UpdateAiPipelineStepCommand)
export class UpdateAiPipelineStepHandler
  extends TransactionalCommandHandler<
    UpdateAiPipelineStepCommand,
    { id: string }
  >
  implements ICommandHandler<UpdateAiPipelineStepCommand, { id: string }>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(AI_PIPELINE_STEP_REPOSITORY)
    private readonly steps: IAiPipelineStepRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: UpdateAiPipelineStepCommand,
  ): Promise<{ id: string }> {
    const entity = await this.steps.findById(command.stepId);
    if (!entity) {
      throw new NotFoundException(
        WORKFLOW_ERROR_CODES.AI_STEP_NOT_FOUND,
        'Không tìm thấy bước AI.',
      );
    }
    const { dto } = command;
    if (dto.nameVi !== undefined) entity.nameVi = dto.nameVi;
    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.paramsSchema !== undefined) entity.paramsSchema = dto.paramsSchema;
    if (dto.defaultParams !== undefined)
      entity.defaultParams = dto.defaultParams;
    if (dto.active !== undefined) entity.active = dto.active;
    if (dto.sortOrder !== undefined) entity.sortOrder = dto.sortOrder;
    await this.steps.save(entity);
    return { id: entity.id };
  }
}
