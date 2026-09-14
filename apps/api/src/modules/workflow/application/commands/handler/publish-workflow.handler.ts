import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import {
  BusinessRuleException,
  NotFoundException,
} from '@app/shared/errors/application.exception';
import { checkWorkflowConfig } from '../../validate-workflow-config';
import { WORKFLOW_REPOSITORY } from '../../../infrastructure/repositories/workflow.repository.interface';
import type { IWorkflowRepository } from '../../../infrastructure/repositories/workflow.repository.interface';
import { WORKFLOW_VERSION_REPOSITORY } from '../../../infrastructure/repositories/workflow-version.repository.interface';
import type { IWorkflowVersionRepository } from '../../../infrastructure/repositories/workflow-version.repository.interface';
import { WORKFLOW_ERROR_CODES } from '../../../workflow.error-codes';
import { PublishWorkflowCommand } from '../command/publish-workflow.command';
import { WorkflowResult } from '../result/workflow.result';

/**
 * Freezes the workflow's current draft version and points `Workflow.
 * currentVersionId` at it — "DRAFT → ACTIVE (version đóng băng)" or, for a
 * workflow already ACTIVE with a new draft prepared alongside, "ACTIVE →
 * still ACTIVE, currentVersionId now = new version" (plan §2.2's exact
 * two-branch lifecycle — `Workflow.markVersionPublished()` handles both
 * without this handler needing to branch on the workflow's prior status).
 * Re-validates the config one more time at publish time — not just
 * trusting whatever passed at the last `PATCH`, since the shared
 * `capture-angles.validator.ts` rules could theoretically change between
 * when a draft was last saved and when it is published.
 */
@CommandHandler(PublishWorkflowCommand)
export class PublishWorkflowHandler
  extends TransactionalCommandHandler<PublishWorkflowCommand, WorkflowResult>
  implements ICommandHandler<PublishWorkflowCommand, WorkflowResult>
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
    command: PublishWorkflowCommand,
  ): Promise<WorkflowResult> {
    const workflow = await this.workflows.findById(command.workflowId);
    if (!workflow) {
      throw new NotFoundException(
        WORKFLOW_ERROR_CODES.WORKFLOW_NOT_FOUND,
        'Không tìm thấy nghiệp vụ.',
      );
    }

    const draft = await this.versions.findDraftByWorkflow(command.workflowId);
    if (!draft) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.NO_DRAFT_VERSION,
        'Không có version nháp để publish.',
      );
    }

    const configCheck = checkWorkflowConfig(draft.config);
    if (!configCheck.valid) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.CONFIG_INVALID,
        `Cấu hình không hợp lệ, không thể publish: ${configCheck.errors.join('; ')}`,
      );
    }

    const publishResult = draft.publish(command.publishedByUserId);
    if (publishResult.isFailure) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.VERSION_ALREADY_PUBLISHED,
        publishResult.error,
      );
    }
    await this.versions.save(draft);

    const markResult = workflow.markVersionPublished(draft.id);
    if (markResult.isFailure) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.WORKFLOW_IN_USE,
        markResult.error,
      );
    }
    await this.workflows.save(workflow);

    return {
      id: workflow.id,
      code: workflow.code,
      name: workflow.name,
      description: workflow.description,
      status: workflow.status,
      currentVersionId: workflow.currentVersionId,
    };
  }
}
