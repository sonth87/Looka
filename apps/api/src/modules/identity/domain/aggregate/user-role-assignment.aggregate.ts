import { randomUUID } from 'node:crypto';
import { AggregateRoot } from '@app/shared/domain/aggregate-root';
import { Result } from '@app/shared/domain/result';
import { UserRoleAssignedEvent } from '../event/user-role-assigned.event';

export interface UserRoleAssignmentProps {
  readonly id: string;
  readonly userId: string;
  readonly roleId: string;
  readonly roleCode: string;
  readonly grantedByUserId: string | null;
  readonly grantedAt: Date;
}

/**
 * One `user_roles` row. Deliberately its own small aggregate rather than a
 * method on a `User` aggregate: `modules/identity` does not own `User` yet
 * (backend-layering-plan.md §6 puts that extraction at Giai đoạn 3) — this
 * keeps the RBAC feature fully self-contained until that move happens, per
 * that plan's own Q11 note ("rbac của CMS 8 màn đặt ở đây").
 *
 * Revocation is a delete, not a state transition (no `revoke()` method
 * here) — the command handler calls the repository directly and raises
 * `UserRoleRevokedEvent` itself, since there is no aggregate instance left
 * to raise it from after removal.
 */
export class UserRoleAssignment extends AggregateRoot<string> {
  private constructor(private readonly props: UserRoleAssignmentProps) {
    super(props.id);
  }

  get userId(): string {
    return this.props.userId;
  }

  get roleId(): string {
    return this.props.roleId;
  }

  get roleCode(): string {
    return this.props.roleCode;
  }

  get grantedByUserId(): string | null {
    return this.props.grantedByUserId;
  }

  get grantedAt(): Date {
    return this.props.grantedAt;
  }

  static reconstruct(props: UserRoleAssignmentProps): UserRoleAssignment {
    return new UserRoleAssignment(props);
  }

  static create(input: {
    userId: string;
    roleId: string;
    roleCode: string;
    grantedByUserId: string | null;
  }): Result<UserRoleAssignment> {
    const assignment = new UserRoleAssignment({
      id: randomUUID(),
      userId: input.userId,
      roleId: input.roleId,
      roleCode: input.roleCode,
      grantedByUserId: input.grantedByUserId,
      grantedAt: new Date(),
    });
    assignment.raise(
      new UserRoleAssignedEvent(
        assignment.id,
        input.userId,
        input.roleId,
        input.roleCode,
        input.grantedByUserId,
      ),
    );
    return Result.ok(assignment);
  }
}
