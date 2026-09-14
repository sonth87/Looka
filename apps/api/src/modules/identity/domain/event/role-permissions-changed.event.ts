import { DomainEvent } from '@app/shared/domain/domain-event';

/**
 * Raised whenever a role's granted permission set changes shape (not just
 * "role touched" — the before/after codes ride along so an audit-log event
 * handler, once modules/audit exists per backend-layering-plan.md §6 Giai
 * đoạn 3, can record exactly what changed without re-querying).
 */
export class RolePermissionsChangedEvent extends DomainEvent {
  readonly eventName = 'RolePermissionsChanged';

  constructor(
    roleId: string,
    public readonly roleCode: string,
    public readonly beforeCodes: readonly string[],
    public readonly afterCodes: readonly string[],
    correlationId?: string,
  ) {
    super(roleId, correlationId);
  }
}
