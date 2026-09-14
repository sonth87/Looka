import { DomainEvent } from '@app/shared/domain/domain-event';

export class RoleCreatedEvent extends DomainEvent {
  readonly eventName = 'RoleCreated';

  constructor(
    roleId: string,
    public readonly code: string,
    correlationId?: string,
  ) {
    super(roleId, correlationId);
  }
}
