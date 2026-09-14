import { DomainEvent } from '@app/shared/domain/domain-event';

export class UserRoleRevokedEvent extends DomainEvent {
  readonly eventName = 'UserRoleRevoked';

  constructor(
    assignmentId: string,
    public readonly userId: string,
    public readonly roleId: string,
    public readonly roleCode: string,
    correlationId?: string,
  ) {
    super(assignmentId, correlationId);
  }
}
