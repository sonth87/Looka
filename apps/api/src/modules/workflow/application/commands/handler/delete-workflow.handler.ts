import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import {
  BusinessRuleException,
  NotFoundException,
} from '@app/shared/errors/application.exception';
import { WORKFLOW_REPOSITORY } from '../../../infrastructure/repositories/workflow.repository.interface';
import type { IWorkflowRepository } from '../../../infrastructure/repositories/workflow.repository.interface';
import { WORKFLOW_ERROR_CODES } from '../../../workflow.error-codes';
import { DeleteWorkflowCommand } from '../command/delete-workflow.command';

/** "Xóa cứng chỉ khi DRAFT và chưa campaign nào trỏ tới" (plan §2.2). */
@CommandHandler(DeleteWorkflowCommand)
export class DeleteWorkflowHandler
  extends TransactionalCommandHandler<DeleteWorkflowCommand, { id: string }>
  implements ICommandHandler<DeleteWorkflowCommand, { id: string }>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(WORKFLOW_REPOSITORY)
    private readonly workflows: IWorkflowRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: DeleteWorkflowCommand,
  ): Promise<{ id: string }> {
    const workflow = await this.workflows.findById(command.workflowId);
    if (!workflow) {
      throw new NotFoundException(
        WORKFLOW_ERROR_CODES.WORKFLOW_NOT_FOUND,
        'Không tìm thấy nghiệp vụ.',
      );
    }
    if (workflow.status !== 'DRAFT') {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.WORKFLOW_IN_USE,
        `Chỉ xóa được nghiệp vụ đang DRAFT (hiện tại: ${workflow.status}) — dùng "Lưu trữ" thay vì xóa.`,
      );
    }
    const usageCount = await this.workflows.countCampaignsUsing(workflow.id);
    if (usageCount > 0) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.WORKFLOW_IN_USE,
        `Nghiệp vụ đang được ${usageCount} đợt chụp dùng — không thể xóa.`,
      );
    }
    await this.workflows.delete(workflow.id);
    return { id: workflow.id };
  }
}
