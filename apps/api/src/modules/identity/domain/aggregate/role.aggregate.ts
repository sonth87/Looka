import { randomUUID } from 'node:crypto';
import { AggregateRoot } from '@app/shared/domain/aggregate-root';
import { Result } from '@app/shared/domain/result';
import { RoleCreatedEvent } from '../event/role-created.event';
import { RolePermissionsChangedEvent } from '../event/role-permissions-changed.event';

export interface RoleProps {
  readonly id: string;
  readonly code: string;
  name: string;
  description: string | null;
  readonly isSystem: boolean;
  permissionCodes: string[];
}

/**
 * A named bundle of permissions. `code` is the natural key and is never
 * mutable after creation (no `changeCode()` method exists) — the same
 * immutable-natural-key convention `campaigns.code` already uses.
 * `isSystem` rows (`ADMIN`, `REVIEWER` — seeded by
 * `1809000000000-CreateRbac.ts`) may still have their permission set
 * edited and their `name`/`description` renamed; only deletion is blocked,
 * and that check lives in the command handler (deletion is a repository
 * operation, not an aggregate state transition).
 */
export class Role extends AggregateRoot<string> {
  private props: RoleProps;

  private constructor(props: RoleProps) {
    super(props.id);
    this.props = props;
  }

  get code(): string {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get isSystem(): boolean {
    return this.props.isSystem;
  }

  get permissionCodes(): readonly string[] {
    return [...this.props.permissionCodes];
  }

  /** Reconstructs an existing row — no event raised (the repository's own load path). */
  static reconstruct(props: RoleProps): Role {
    return new Role(props);
  }

  static create(input: {
    code: string;
    name: string;
    description?: string | null;
  }): Result<Role> {
    const code = input.code.trim().toUpperCase();
    if (!code) {
      return Result.fail('Mã vai trò không được để trống.');
    }
    if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(code)) {
      return Result.fail(
        'Mã vai trò chỉ gồm chữ hoa, số, gạch dưới, bắt đầu bằng chữ, tối đa 50 ký tự.',
      );
    }
    const name = input.name.trim();
    if (!name) {
      return Result.fail('Tên vai trò không được để trống.');
    }

    const role = new Role({
      id: randomUUID(),
      code,
      name,
      description: input.description?.trim() || null,
      isSystem: false,
      permissionCodes: [],
    });
    role.raise(new RoleCreatedEvent(role.id, code));
    return Result.ok(role);
  }

  rename(name: string, description?: string | null): Result<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return Result.fail('Tên vai trò không được để trống.');
    }
    if (
      this.props.name === trimmedName &&
      (this.props.description ?? null) === (description?.trim() || null)
    ) {
      return Result.noop(undefined);
    }
    this.props.name = trimmedName;
    this.props.description = description?.trim() || null;
    return Result.ok(undefined);
  }

  /**
   * Replaces the whole permission set. Codes are not validated against the
   * live `permissions` catalog here (the aggregate does not import
   * `shared/database`/repositories per the ban list) — the command handler
   * validates against the catalog read repository before calling this.
   */
  setPermissions(codes: readonly string[]): Result<void> {
    const before = [...this.props.permissionCodes].sort();
    const after = [...new Set(codes)].sort();
    if (
      before.length === after.length &&
      before.every((c, i) => c === after[i])
    ) {
      return Result.noop(undefined);
    }
    this.props.permissionCodes = after;
    this.raise(
      new RolePermissionsChangedEvent(this.id, this.props.code, before, after),
    );
    return Result.ok(undefined);
  }
}
