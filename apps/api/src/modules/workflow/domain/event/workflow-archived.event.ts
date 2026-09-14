import { DomainEvent } from '@app/shared/domain/domain-event';

export class WorkflowArchivedEvent extends DomainEvent {
  readonly eventName = 'WorkflowArchived';

  constructor(
    workflowId: string,
    public readonly code: string,
    correlationId?: string,
  ) {
    super(workflowId, correlationId);
  }
}
