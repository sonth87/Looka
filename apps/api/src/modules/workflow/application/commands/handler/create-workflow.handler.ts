import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import { ValidationException } from '@app/shared/errors/application.exception';
import { Workflow } from '../../../domain/aggregate/workflow.aggregate';
import { WorkflowVersion } from '../../../domain/aggregate/workflow-version.aggregate';
import { WORKFLOW_REPOSITORY } from '../../../infrastructure/repositories/workflow.repository.interface';
import type { IWorkflowRepository } from '../../../infrastructure/repositories/workflow.repository.interface';
import { WORKFLOW_VERSION_REPOSITORY } from '../../../infrastructure/repositories/workflow-version.repository.interface';
import type { IWorkflowVersionRepository } from '../../../infrastructure/repositories/workflow-version.repository.interface';
import { checkWorkflowConfig } from '../../validate-workflow-config';
import { reconcileEligibilityCredential } from '../../eligibility-credential.util';
import { WORKFLOW_ERROR_CODES } from '../../../workflow.error-codes';
import { CreateWorkflowCommand } from '../command/create-workflow.command';
import { WorkflowResult } from '../result/workflow.result';

/** Creates a `DRAFT` workflow with its first (draft, `version=1`) config row — nothing is published yet, a campaign cannot select it until `POST /v1/workflows/:id/publish`. */
@CommandHandler(CreateWorkflowCommand)
export class CreateWorkflowHandler
  extends TransactionalCommandHandler<CreateWorkflowCommand, WorkflowResult>
  implements ICommandHandler<CreateWorkflowCommand, WorkflowResult>
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
    command: CreateWorkflowCommand,
  ): Promise<WorkflowResult> {
    const configCheck = checkWorkflowConfig(command.config);
    if (!configCheck.valid) {
      throw new ValidationException(
        WORKFLOW_ERROR_CODES.CONFIG_INVALID,
        configCheck.errors.join('; '),
      );
    }
    // No previous config to preserve a credential from — brand new workflow.
    const config = reconcileEligibilityCredential(command.config, null);

    const result = Workflow.create({
      code: command.code,
      name: command.name,
      description: command.description,
      createdByUserId: command.createdByUserId,
    });
    if (result.isFailure) {
      throw new ValidationException(
        WORKFLOW_ERROR_CODES.WORKFLOW_VALIDATION_FAILED,
        result.error,
      );
    }
    const workflow = result.value;
    await this.workflows.save(workflow);

    const draft = WorkflowVersion.createDraft({
      workflowId: workflow.id,
      version: 1,
      config,
    });
    await this.versions.save(draft);

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
