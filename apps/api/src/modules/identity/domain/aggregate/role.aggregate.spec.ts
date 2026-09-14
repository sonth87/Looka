import { Role } from './role.aggregate';

describe('Role aggregate (pure — no DB, per plan §6 Giai đoạn 0 unit test convention)', () => {
  describe('create', () => {
    it('creates a role, uppercases the code, and raises RoleCreated', () => {
      const result = Role.create({
        code: 'ctsv',
        name: 'Cán bộ tuyển sinh viên',
      });
      expect(result.isSuccess).toBe(true);
      const role = result.value;
      expect(role.code).toBe('CTSV');
      expect(role.isSystem).toBe(false);
      expect(role.permissionCodes).toEqual([]);
      expect(role.domainEvents).toHaveLength(1);
      expect(role.domainEvents[0].eventName).toBe('RoleCreated');
    });

    it('fails on an empty code', () => {
      const result = Role.create({ code: '   ', name: 'x' });
      expect(result.isFailure).toBe(true);
    });

    it('fails on a code with invalid characters', () => {
      const result = Role.create({ code: 'ctsv-1', name: 'x' });
      expect(result.isFailure).toBe(true);
    });

    it('fails on an empty name', () => {
      const result = Role.create({ code: 'CTSV', name: '  ' });
      expect(result.isFailure).toBe(true);
    });
  });

  describe('rename', () => {
    it('updates name/description and does not raise a domain event', () => {
      const role = Role.create({ code: 'CTSV', name: 'Old' }).value;
      role.clearDomainEvents();

      const result = role.rename('New name', 'New description');
      expect(result.isSuccess).toBe(true);
      expect(role.name).toBe('New name');
      expect(role.description).toBe('New description');
      // rename() deliberately does not raise — only setPermissions() does
      // (role.aggregate.ts's own doc comment); confirms no accidental event.
      expect(role.domainEvents).toHaveLength(0);
    });

    it('returns noop when nothing actually changed', () => {
      const role = Role.create({ code: 'CTSV', name: 'Same' }).value;
      const result = role.rename('Same', undefined);
      expect(result.isNoop).toBe(true);
      expect(result.isSuccess).toBe(true);
    });

    it('fails on an empty name', () => {
      const role = Role.create({ code: 'CTSV', name: 'X' }).value;
      const result = role.rename('   ');
      expect(result.isFailure).toBe(true);
    });
  });

  describe('setPermissions', () => {
    it('replaces the set and raises RolePermissionsChanged with before/after codes', () => {
      const role = Role.create({ code: 'CTSV', name: 'X' }).value;
      role.clearDomainEvents();

      const result = role.setPermissions(['campaign:write', 'campaign:read']);
      expect(result.isSuccess).toBe(true);
      expect(role.permissionCodes).toEqual(['campaign:read', 'campaign:write']); // sorted

      expect(role.domainEvents).toHaveLength(1);
      const event = role.domainEvents[0] as unknown as {
        beforeCodes: string[];
        afterCodes: string[];
      };
      expect(event.beforeCodes).toEqual([]);
      expect(event.afterCodes).toEqual(['campaign:read', 'campaign:write']);
    });

    it('dedupes codes', () => {
      const role = Role.create({ code: 'CTSV', name: 'X' }).value;
      role.setPermissions(['a:read', 'a:read', 'b:read']);
      expect(role.permissionCodes).toEqual(['a:read', 'b:read']);
    });

    it('returns noop when the set is unchanged (order-independent)', () => {
      const role = Role.create({ code: 'CTSV', name: 'X' }).value;
      role.setPermissions(['a:read', 'b:read']);
      role.clearDomainEvents();

      const result = role.setPermissions(['b:read', 'a:read']);
      expect(result.isNoop).toBe(true);
      expect(role.domainEvents).toHaveLength(0);
    });
  });

  describe('reconstruct', () => {
    it('rebuilds a role from persisted state without raising any event', () => {
      const role = Role.reconstruct({
        id: 'existing-id',
        code: 'ADMIN',
        name: 'Quản trị viên',
        description: null,
        isSystem: true,
        permissionCodes: ['role:write'],
      });
      expect(role.id).toBe('existing-id');
      expect(role.isSystem).toBe(true);
      expect(role.domainEvents).toHaveLength(0);
    });
  });
});
