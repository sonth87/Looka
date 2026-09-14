import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import {
  BusinessRuleException,
  NotFoundException,
} from '@app/shared/errors/application.exception';
import { WorkflowVersion } from '../../../domain/aggregate/workflow-version.aggregate';
import { WORKFLOW_REPOSITORY } from '../../../infrastructure/repositories/workflow.repository.interface';
import type { IWorkflowRepository } from '../../../infrastructure/repositories/workflow.repository.interface';
import { WORKFLOW_VERSION_REPOSITORY } from '../../../infrastructure/repositories/workflow-version.repository.interface';
import type { IWorkflowVersionRepository } from '../../../infrastructure/repositories/workflow-version.repository.interface';
import { WORKFLOW_ERROR_CODES } from '../../../workflow.error-codes';
import { CreateWorkflowDraftVersionCommand } from '../command/create-workflow-draft-version.command';
import { WorkflowVersionResult } from '../result/workflow.result';

/**
 * "Sửa tiếp = tạo version nháp mới" (plan §2.2) — copies the CURRENT
 * PUBLISHED version's config as the starting point for the new draft
 * (nothing to author from scratch), leaving the currently-live
 * `currentVersionId` completely untouched: existing campaigns pinned to
 * the old version keep resolving to it until this new draft is itself
 * published (`PublishWorkflowCommand`).
 */
@CommandHandler(CreateWorkflowDraftVersionCommand)
export class CreateWorkflowDraftVersionHandler
  extends TransactionalCommandHandler<
    CreateWorkflowDraftVersionCommand,
    WorkflowVersionResult
  >
  implements
    ICommandHandler<CreateWorkflowDraftVersionCommand, WorkflowVersionResult>
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
    command: CreateWorkflowDraftVersionCommand,
  ): Promise<WorkflowVersionResult> {
    const workflow = await this.workflows.findById(command.workflowId);
    if (!workflow) {
      throw new NotFoundException(
        WORKFLOW_ERROR_CODES.WORKFLOW_NOT_FOUND,
        'Không tìm thấy nghiệp vụ.',
      );
    }
    if (!workflow.currentVersionId) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.NO_DRAFT_VERSION,
        'Nghiệp vụ chưa từng publish — sửa trực tiếp version nháp hiện có (chưa cần tạo version mới).',
      );
    }

    const existingDraft = await this.versions.findDraftByWorkflow(
      command.workflowId,
    );
    if (existingDraft) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.DRAFT_ALREADY_EXISTS,
        `Đã có version nháp (v${existingDraft.version}) — sửa version đó thay vì tạo mới.`,
      );
    }

    const currentVersion = await this.versions.findById(
      workflow.currentVersionId,
    );
    if (!currentVersion) {
      throw new NotFoundException(
        WORKFLOW_ERROR_CODES.VERSION_NOT_FOUND,
        'Không tìm thấy version hiện tại.',
      );
    }

    const nextNumber = await this.versions.nextVersionNumber(
      command.workflowId,
    );
    const draft = WorkflowVersion.createDraft({
      workflowId: command.workflowId,
      version: nextNumber,
      config: currentVersion.config,
      note: `Nhân bản từ v${currentVersion.version}`,
    });
    await this.versions.save(draft);

    return {
      id: draft.id,
      workflowId: draft.workflowId,
      version: draft.version,
      isDraft: draft.isDraft,
    };
  }
}
