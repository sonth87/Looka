import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import {
  BusinessRuleException,
  NotFoundException,
  ValidationException,
} from '@app/shared/errors/application.exception';
import { WORKFLOW_REPOSITORY } from '../../../infrastructure/repositories/workflow.repository.interface';
import type { IWorkflowRepository } from '../../../infrastructure/repositories/workflow.repository.interface';
import { WORKFLOW_VERSION_REPOSITORY } from '../../../infrastructure/repositories/workflow-version.repository.interface';
import type { IWorkflowVersionRepository } from '../../../infrastructure/repositories/workflow-version.repository.interface';
import { checkWorkflowConfig } from '../../validate-workflow-config';
import { reconcileEligibilityCredential } from '../../eligibility-credential.util';
import { WORKFLOW_ERROR_CODES } from '../../../workflow.error-codes';
import { UpdateWorkflowVersionConfigCommand } from '../command/update-workflow-version-config.command';
import { WorkflowVersionResult } from '../result/workflow.result';

@CommandHandler(UpdateWorkflowVersionConfigCommand)
export class UpdateWorkflowVersionConfigHandler
  extends TransactionalCommandHandler<
    UpdateWorkflowVersionConfigCommand,
    WorkflowVersionResult
  >
  implements
    ICommandHandler<UpdateWorkflowVersionConfigCommand, WorkflowVersionResult>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(WORKFLOW_REPOSITORY)
    private readonly workflows: IWorkflowRepository,
    @Inject(WORKFLOW_VERSION_REPOSITORY)
    private readonly versions: IWorkflowVersionRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: UpdateWorkflowVersionConfigCommand,
  ): Promise<WorkflowVersionResult> {
    const workflow = await this.workflows.findById(command.workflowId);
    if (!workflow) {
      throw new NotFoundException(
        WORKFLOW_ERROR_CODES.WORKFLOW_NOT_FOUND,
        'Không tìm thấy nghiệp vụ.',
      );
    }

    const configCheck = checkWorkflowConfig(command.config);
    if (!configCheck.valid) {
      throw new ValidationException(
        WORKFLOW_ERROR_CODES.CONFIG_INVALID,
        configCheck.errors.join('; '),
      );
    }

    const draft = await this.versions.findDraftByWorkflow(command.workflowId);
    if (!draft) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.NO_DRAFT_VERSION,
        'Nghiệp vụ không có version nháp — tạo version nháp mới trước khi sửa cấu hình.',
      );
    }

    // Preserves the draft's already-stored credential when this save
    // doesn't touch it — see `reconcileEligibilityCredential`'s own doc
    // comment for why that's needed (GET never echoes the ciphertext back).
    const config = reconcileEligibilityCredential(command.config, draft.config);
    const result = draft.updateConfig(config, command.note);
    if (result.isFailure) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.VERSION_ALREADY_PUBLISHED,
        result.error,
      );
    }
    await this.versions.save(draft);

    return {
      id: draft.id,
      workflowId: draft.workflowId,
      version: draft.version,
      isDraft: draft.isDraft,
    };
  }
}
