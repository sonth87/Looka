import { AiPipelineStepEntity } from '../persistence/ai-pipeline-step.entity';

export const AI_PIPELINE_STEP_REPOSITORY = Symbol(
  'AI_PIPELINE_STEP_REPOSITORY',
);

/** Plain entity CRUD — not an aggregate, same reasoning `PermissionEntity`/`UserProfileRepository` document: a catalog row has no independent business state to protect. */
export interface IAiPipelineStepRepository {
  findById(id: string): Promise<AiPipelineStepEntity | null>;
  findByCode(code: string): Promise<AiPipelineStepEntity | null>;
  save(entity: AiPipelineStepEntity): Promise<AiPipelineStepEntity>;
}
