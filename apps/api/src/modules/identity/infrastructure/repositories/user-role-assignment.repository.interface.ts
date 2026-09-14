import { UserRoleAssignment } from '../../domain/aggregate/user-role-assignment.aggregate';

export const USER_ROLE_ASSIGNMENT_REPOSITORY = Symbol(
  'USER_ROLE_ASSIGNMENT_REPOSITORY',
);

export interface IUserRoleAssignmentRepository {
  findByUserAndRole(
    userId: string,
    roleId: string,
  ): Promise<UserRoleAssignment | null>;
  listByUser(userId: string): Promise<UserRoleAssignment[]>;
  save(assignment: UserRoleAssignment): Promise<void>;
  /** Deletes and returns the event handler should raise, or null if nothing was assigned. */
  revoke(
    userId: string,
    roleId: string,
  ): Promise<{ id: string; roleCode: string } | null>;
}
