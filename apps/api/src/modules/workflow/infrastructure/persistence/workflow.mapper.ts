import { Workflow } from '../../domain/aggregate/workflow.aggregate';
import { WorkflowEntity } from './workflow.entity';

export class WorkflowMapper {
  static toDomain(entity: WorkflowEntity): Workflow {
    return Workflow.reconstruct({
      id: entity.id,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      status: entity.status,
      currentVersionId: entity.currentVersionId,
      createdByUserId: entity.createdByUserId,
    });
  }

  static toEntity(
    workflow: Workflow,
    existing?: WorkflowEntity,
  ): WorkflowEntity {
    const entity = existing ?? new WorkflowEntity();
    entity.id = workflow.id;
    entity.code = workflow.code;
    entity.name = workflow.name;
    entity.description = workflow.description;
    entity.status = workflow.status;
    entity.currentVersionId = workflow.currentVersionId;
    entity.createdByUserId = workflow.createdByUserId;
    return entity;
  }
}
