import { WorkflowVersion } from '../../domain/aggregate/workflow-version.aggregate';
import { WorkflowVersionEntity } from './workflow-version.entity';

export class WorkflowVersionMapper {
  static toDomain(entity: WorkflowVersionEntity): WorkflowVersion {
    return WorkflowVersion.reconstruct({
      id: entity.id,
      workflowId: entity.workflowId,
      version: entity.version,
      config: entity.config,
      publishedAt: entity.publishedAt,
      publishedByUserId: entity.publishedByUserId,
      note: entity.note,
    });
  }

  static toEntity(
    version: WorkflowVersion,
    existing?: WorkflowVersionEntity,
  ): WorkflowVersionEntity {
    const entity = existing ?? new WorkflowVersionEntity();
    entity.id = version.id;
    entity.workflowId = version.workflowId;
    entity.version = version.version;
    entity.config = version.config;
    entity.publishedAt = version.publishedAt;
    entity.publishedByUserId = version.publishedByUserId;
    entity.note = version.note;
    return entity;
  }
}
