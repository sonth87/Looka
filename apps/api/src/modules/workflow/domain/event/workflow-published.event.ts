import { DomainEvent } from '@app/shared/domain/domain-event';

export class WorkflowPublishedEvent extends DomainEvent {
  readonly eventName = 'WorkflowPublished';

  constructor(
    workflowId: string,
    public readonly code: string,
    public readonly versionId: string,
    correlationId?: string,
  ) {
    super(workflowId, correlationId);
  }
}
