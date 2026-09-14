import { Role } from '../../domain/aggregate/role.aggregate';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

export interface IRoleRepository {
  findById(id: string): Promise<Role | null>;
  findByCode(code: string): Promise<Role | null>;
  /** Saves the role row and, if `setPermissions()` changed anything, replaces `role_permissions` wholesale. */
  save(role: Role): Promise<void>;
  /** Throws if the role is `isSystem` — callers should check `role.isSystem` first for a friendlier error. */
  delete(id: string): Promise<void>;
}
