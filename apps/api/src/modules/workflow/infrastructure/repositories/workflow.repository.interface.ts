import { Workflow } from '../../domain/aggregate/workflow.aggregate';

export const WORKFLOW_REPOSITORY = Symbol('WORKFLOW_REPOSITORY');

export interface IWorkflowRepository {
  findById(id: string): Promise<Workflow | null>;
  findByCode(code: string): Promise<Workflow | null>;
  save(workflow: Workflow): Promise<void>;
  /** Throws if any campaign still references this workflow — check `countCampaignsUsing()` first for a friendlier error. */
  delete(id: string): Promise<void>;
  countCampaignsUsing(workflowId: string): Promise<number>;
}
