import { Injectable } from '@nestjs/common';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { Workflow } from '../../domain/aggregate/workflow.aggregate';
import { WorkflowEntity } from '../persistence/workflow.entity';
import { WorkflowMapper } from '../persistence/workflow.mapper';
import { IWorkflowRepository } from './workflow.repository.interface';

@Injectable()
export class WorkflowRepository implements IWorkflowRepository {
  constructor(private readonly context: TransactionContext) {}

  async findById(id: string): Promise<Workflow | null> {
    const entity = await this.context
      .manager()
      .findOneBy(WorkflowEntity, { id });
    return entity ? WorkflowMapper.toDomain(entity) : null;
  }

  async findByCode(code: string): Promise<Workflow | null> {
    const entity = await this.context
      .manager()
      .findOneBy(WorkflowEntity, { code });
    return entity ? WorkflowMapper.toDomain(entity) : null;
  }

  async save(workflow: Workflow): Promise<void> {
    const manager = this.context.manager();
    const existing = await manager.findOneBy(WorkflowEntity, {
      id: workflow.id,
    });
    const entity = WorkflowMapper.toEntity(workflow, existing ?? undefined);
    await manager.save(WorkflowEntity, entity);

    this.context.registerEvents(workflow.domainEvents);
    workflow.clearDomainEvents();
  }

  async delete(id: string): Promise<void> {
    await this.context.manager().delete(WorkflowEntity, { id });
  }

  async countCampaignsUsing(workflowId: string): Promise<number> {
    const rows: Array<{ count: string }> = await this.context
      .manager()
      .query(
        'SELECT COUNT(*)::text AS count FROM campaigns WHERE workflow_id = $1',
        [workflowId],
      );
    return Number(rows[0]?.count ?? 0);
  }
}
