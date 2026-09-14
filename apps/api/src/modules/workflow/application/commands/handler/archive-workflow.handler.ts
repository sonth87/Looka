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
import { ArchiveWorkflowCommand } from '../command/archive-workflow.command';
import { WorkflowResult } from '../result/workflow.result';

@CommandHandler(ArchiveWorkflowCommand)
export class ArchiveWorkflowHandler
  extends TransactionalCommandHandler<ArchiveWorkflowCommand, WorkflowResult>
  implements ICommandHandler<ArchiveWorkflowCommand, WorkflowResult>
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(WORKFLOW_REPOSITORY)
    private readonly workflows: IWorkflowRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: ArchiveWorkflowCommand,
  ): Promise<WorkflowResult> {
    const workflow = await this.workflows.findById(command.workflowId);
    if (!workflow) {
      throw new NotFoundException(
        WORKFLOW_ERROR_CODES.WORKFLOW_NOT_FOUND,
        'Không tìm thấy nghiệp vụ.',
      );
    }
    const result = workflow.archive();
    if (result.isFailure) {
      throw new BusinessRuleException(
        WORKFLOW_ERROR_CODES.WORKFLOW_VALIDATION_FAILED,
        result.error,
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
