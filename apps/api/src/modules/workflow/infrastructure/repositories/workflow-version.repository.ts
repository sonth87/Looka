import { Injectable } from '@nestjs/common';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { WorkflowVersion } from '../../domain/aggregate/workflow-version.aggregate';
import { WorkflowVersionEntity } from '../persistence/workflow-version.entity';
import { WorkflowVersionMapper } from '../persistence/workflow-version.mapper';
import { IWorkflowVersionRepository } from './workflow-version.repository.interface';

@Injectable()
export class WorkflowVersionRepository implements IWorkflowVersionRepository {
  constructor(private readonly context: TransactionContext) {}

  async findById(id: string): Promise<WorkflowVersion | null> {
    const entity = await this.context
      .manager()
      .findOneBy(WorkflowVersionEntity, { id });
    return entity ? WorkflowVersionMapper.toDomain(entity) : null;
  }

  /**
   * `IS NULL` needs a query builder — TypeORM's `findOneBy({ publishedAt:
   * null })` equality-object form does not translate to `IS NULL` the way
   * one might expect for a nullable column, so this goes straight to the
   * query builder rather than risk a silently-wrong `WHERE` clause.
   */
  async findDraftByWorkflow(
    workflowId: string,
  ): Promise<WorkflowVersion | null> {
    const found = await this.context
      .manager()
      .createQueryBuilder(WorkflowVersionEntity, 'v')
      .where('v.workflow_id = :workflowId', { workflowId })
      .andWhere('v.published_at IS NULL')
      .getOne();
    return found ? WorkflowVersionMapper.toDomain(found) : null;
  }

  async listByWorkflow(workflowId: string): Promise<WorkflowVersion[]> {
    const entities = await this.context.manager().find(WorkflowVersionEntity, {
      where: { workflowId },
      order: { version: 'DESC' },
    });
    return entities.map((e) => WorkflowVersionMapper.toDomain(e));
  }

  async nextVersionNumber(workflowId: string): Promise<number> {
    const rows: Array<{ max: number | null }> = await this.context
      .manager()
      .query(
        'SELECT MAX(version) AS max FROM workflow_versions WHERE workflow_id = $1',
        [workflowId],
      );
    return (rows[0]?.max ?? 0) + 1;
  }

  async save(version: WorkflowVersion): Promise<void> {
    const manager = this.context.manager();
    const existing = await manager.findOneBy(WorkflowVersionEntity, {
      id: version.id,
    });
    const entity = WorkflowVersionMapper.toEntity(
      version,
      existing ?? undefined,
    );
    await manager.save(WorkflowVersionEntity, entity);

    this.context.registerEvents(version.domainEvents);
    version.clearDomainEvents();
  }
}
