import { DomainEvent } from '@app/shared/domain/domain-event';

export class WorkflowCreatedEvent extends DomainEvent {
  readonly eventName = 'WorkflowCreated';

  constructor(
    workflowId: string,
    public readonly code: string,
    correlationId?: string,
  ) {
    super(workflowId, correlationId);
  }
}
