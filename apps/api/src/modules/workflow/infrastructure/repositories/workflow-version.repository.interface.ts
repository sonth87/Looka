import { WorkflowVersion } from '../../domain/aggregate/workflow-version.aggregate';

export const WORKFLOW_VERSION_REPOSITORY = Symbol(
  'WORKFLOW_VERSION_REPOSITORY',
);

export interface IWorkflowVersionRepository {
  findById(id: string): Promise<WorkflowVersion | null>;
  /** The single draft (`publishedAt IS NULL`) row for a workflow, if any — at most one exists at a time by convention. */
  findDraftByWorkflow(workflowId: string): Promise<WorkflowVersion | null>;
  listByWorkflow(workflowId: string): Promise<WorkflowVersion[]>;
  nextVersionNumber(workflowId: string): Promise<number>;
  save(version: WorkflowVersion): Promise<void>;
}
