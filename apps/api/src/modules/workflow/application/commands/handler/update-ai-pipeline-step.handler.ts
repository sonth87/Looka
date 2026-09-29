import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import {
  ConflictException,
  NotFoundException,
} from '@app/shared/errors/application.exception';
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
    // 2026-09-29 user decision (authz-trust-boundary audit finding) —
    // `defaultParams` on an `is_system` row (the original CARD_CROP/
    // BACKGROUND_REPLACE/SKIN_SMOOTH/AI_EDIT catalog seed) feeds every
    // already-PUBLISHED workflow version that references it, live, with no
    // new version needed — `ai-pipeline-step:write` alone (a narrower grant
    // than `workflow:write`) must not be able to silently redirect what a
    // published workflow's `/edit` step actually sends. Every other field
    // (nameVi/description/paramsSchema/active/sortOrder) stays editable —
    // this locks only the one field that changes generated-image behavior.
    if (dto.defaultParams !== undefined && entity.isSystem) {
      throw new ConflictException(
        WORKFLOW_ERROR_CODES.AI_STEP_SYSTEM_DEFAULT_PARAMS_LOCKED,
        `Cannot change defaultParams on system AI pipeline step "${entity.code}" — it may already be referenced by published workflow versions. Create a new, non-system step instead.`,
      );
    }
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
