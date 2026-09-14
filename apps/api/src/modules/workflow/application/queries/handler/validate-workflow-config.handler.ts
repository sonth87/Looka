import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  checkWorkflowConfig,
  WorkflowConfigCheckResult,
} from '../../validate-workflow-config';
import { ValidateWorkflowConfigQuery } from '../query/validate-workflow-config.query';

/** No DB read at all — `POST /v1/workflows/validate`'s whole job is running `checkWorkflowConfig()` as a dry run, same function every write path already calls before persisting. */
@QueryHandler(ValidateWorkflowConfigQuery)
export class ValidateWorkflowConfigHandler implements IQueryHandler<
  ValidateWorkflowConfigQuery,
  WorkflowConfigCheckResult
> {
  execute(
    query: ValidateWorkflowConfigQuery,
  ): Promise<WorkflowConfigCheckResult> {
    return Promise.resolve(checkWorkflowConfig(query.config));
  }
}
