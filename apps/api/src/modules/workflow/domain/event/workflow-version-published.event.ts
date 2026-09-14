import { DomainEvent } from '@app/shared/domain/domain-event';

export class WorkflowVersionPublishedEvent extends DomainEvent {
  readonly eventName = 'WorkflowVersionPublished';

  constructor(
    versionId: string,
    public readonly workflowId: string,
    public readonly version: number,
    correlationId?: string,
  ) {
    super(versionId, correlationId);
  }
}
