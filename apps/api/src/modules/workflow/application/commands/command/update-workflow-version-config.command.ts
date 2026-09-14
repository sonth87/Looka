import { ICommand } from '@nestjs/cqrs';
import type { WorkflowConfig } from '../../../domain/schema/workflow-config.schema';

/** Updates the workflow's current DRAFT version's config — the one `workflow_versions` row with `publishedAt IS NULL`. Fails with a clear error if none exists (already published, publish a new draft first via `CreateWorkflowDraftVersionCommand`). */
export class UpdateWorkflowVersionConfigCommand implements ICommand {
  constructor(
    public readonly workflowId: string,
    public readonly config: WorkflowConfig,
    public readonly note: string | null | undefined,
  ) {}
}
