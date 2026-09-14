import { DomainEvent } from '@app/shared/domain/domain-event';

export class UserRoleAssignedEvent extends DomainEvent {
  readonly eventName = 'UserRoleAssigned';

  constructor(
    assignmentId: string,
    public readonly userId: string,
    public readonly roleId: string,
    public readonly roleCode: string,
    public readonly grantedByUserId: string | null,
    correlationId?: string,
  ) {
    super(assignmentId, correlationId);
  }
}
