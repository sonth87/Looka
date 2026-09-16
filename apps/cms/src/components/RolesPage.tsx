import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  Paginated,
  Permission,
  Role,
  UserListItem,
  createRole,
  deleteRole,
  getRole,
  getUser,
  listPermissions,
  listRoleUsers,
  listRoles,
  listUsers,
  setRolePermissions,
  setUserRoles,
  updateRole,
} from '../api';
import { ModalShell } from './CampaignDangerActions';
import { DEFAULT_PAGE_SIZE, Pager } from './Pager';

/**
 * "Phân quyền" — role/permission management. Backend is
 * apps/api/src/modules/identity's role.command/query.controller.ts,
 * permission.query.controller.ts, user-role.command.controller.ts (fully
 * built already, this is CMS-only wiring). `GET /v1/roles` and
 * `GET /v1/permissions` are small, un-paginated catalogs fetched once here
 * and handed down to `RoleDetailPage` — the permission checkboxes need the
 * full catalog to render every group regardless of which role is open, and
 * the role list is needed to translate a user's `roleCodes` (all
 * `UserReadModel` carries) into the `roleIds` `PUT /v1/users/:id/roles`
 * actually wants (see `applyRoleToUser` below).
 */
export function RolesPage() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [permissions, setPermissions] = useState<Permission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  const reloadRoles = () => {
    listRoles()
      .then(setRoles)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reloadRoles, []);
  useEffect(() => {
    listPermissions()
      .then(setPermissions)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  function updateRoleInList(updated: Role) {
    setRoles((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev));
  }

  if (selectedRoleId) {
    const selectedRole = roles?.find((r) => r.id === selectedRoleId) ?? null;
    if (!selectedRole || !permissions) {
      return (
        <div>
          <button onClick={() => setSelectedRoleId(null)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">
            ← Quay lại danh sách
          </button>
          {error ? (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>
          ) : (
            <p className="text-gray-500">Đang tải...</p>
          )}
        </div>
      );
    }
    return (
      <RoleDetailPage
        role={selectedRole}
        allRoles={roles ?? []}
        permissions={permissions}
        onBack={() => setSelectedRoleId(null)}
        onRoleUpdated={updateRoleInList}
        onRoleDeleted={() => {
          setSelectedRoleId(null);
          reloadRoles();
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Phân quyền</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Vai trò (role) và quyền (permission) — mỗi vai trò gồm một tập quyền, gán cho người dùng.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shrink-0"
        >
          + Thêm vai trò
        </button>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {roles === null && !error && <p className="text-gray-500">Đang tải...</p>}
      {roles && roles.length === 0 && <p className="text-gray-500">Chưa có vai trò nào.</p>}

      {roles && roles.length > 0 && (
        <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-4">Mã</th>
              <th className="py-2.5 px-4">Tên</th>
              <th className="py-2.5 px-4">Mô tả</th>
              <th className="py-2.5 px-4">Số quyền</th>
              <th className="py-2.5 px-4">Người dùng</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr
                key={r.id}
                className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
                onClick={() => setSelectedRoleId(r.id)}
              >
                <td className="py-2.5 px-4 font-mono text-xs text-gray-700">
                  {r.code}
                  {r.isSystem && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] align-middle">
                      hệ thống
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-gray-900 font-medium">{r.name}</td>
                <td className="py-2.5 px-4 text-gray-500">{r.description || '—'}</td>
                <td className="py-2.5 px-4 text-gray-500 tabular-nums">{r.permissionCodes.length}</td>
                <td className="py-2.5 px-4 text-gray-500 tabular-nums">{r.userCount}</td>
                <td className="py-2.5 px-4 text-right text-blue-600 text-xs font-medium">Chi tiết →</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {createOpen && (
        <CreateRoleModal
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            reloadRoles();
            setSelectedRoleId(created.id);
          }}
        />
      )}
    </div>
  );
}

/**
 * `PUT /v1/users/:id/roles` REPLACES a user's entire role set, but
 * `UserReadModel`/`getUser` only ever hands back `roleCodes` (not ids) — so
 * adding/removing a single role must: read the user's current codes,
 * translate every code this client still recognizes into an id via
 * `allRoles` (a stale/deleted role's code that no longer resolves is
 * silently dropped, same as it already not counting server-side), add or
 * remove the one target id, then send the FULL resulting set. Skipping the
 * read-first step would silently wipe every other role the user has.
 */
async function applyRoleToUser(
  userId: string,
  roleId: string,
  add: boolean,
  allRoles: Role[]
): Promise<{ userId: string; roleCodes: string[] }> {
  const detail = await getUser(userId);
  const codeToId = new Map(allRoles.map((r) => [r.code, r.id]));
  const ids = new Set<string>();
  for (const code of detail.roleCodes) {
    const id = codeToId.get(code);
    if (id) ids.add(id);
  }
  if (add) ids.add(roleId);
  else ids.delete(roleId);
  return setUserRoles(userId, Array.from(ids));
}

function groupPermissions(perms: Permission[]): Array<[string, Permission[]]> {
  const map = new Map<string, Permission[]>();
  for (const p of perms) {
    const list = map.get(p.group) ?? [];
    list.push(p);
    map.set(p.group, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function CreateRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (role: Role) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      onCreated(
        await createRole({ code: code.trim().toUpperCase(), name: name.trim(), description: description.trim() || undefined })
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Thêm vai trò" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Mã vai trò (không đổi được sau khi tạo)</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            placeholder="REVIEWER"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tên vai trò</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Người duyệt ảnh"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Mô tả (tuỳ chọn)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Tạo vai trò'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function RoleDetailPage({
  role,
  allRoles,
  permissions,
  onBack,
  onRoleUpdated,
  onRoleDeleted,
}: {
  role: Role;
  allRoles: Role[];
  permissions: Permission[];
  onBack: () => void;
  onRoleUpdated: (updated: Role) => void;
  onRoleDeleted: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(() => new Set(role.permissionCodes));
  const [savingPerms, setSavingPerms] = useState(false);
  const [permsError, setPermsError] = useState<string | null>(null);

  const [usersPage, setUsersPage] = useState(1);
  const [usersPageSize, setUsersPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [usersResult, setUsersResult] = useState<Paginated<UserListItem> | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [addUserOpen, setAddUserOpen] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // This component stays mounted across a role switch (`RolesPage` doesn't
  // key it by role id), so the edit/permission local state must explicitly
  // resync whenever a different role opens rather than relying on
  // `useState`'s one-time initializer.
  useEffect(() => {
    setName(role.name);
    setDescription(role.description ?? '');
    setSelectedCodes(new Set(role.permissionCodes));
  }, [role.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadUsers = () => {
    setUsersError(null);
    listRoleUsers(role.id, { page: usersPage, limit: usersPageSize })
      .then(setUsersResult)
      .catch((err) => setUsersError(err instanceof ApiError ? err.message : String(err)));
  };
  useEffect(reloadUsers, [role.id, usersPage, usersPageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveInfo(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingInfo(true);
    setInfoError(null);
    try {
      onRoleUpdated(await updateRole(role.id, { name: name.trim(), description: description.trim() || undefined }));
    } catch (err) {
      setInfoError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSavingInfo(false);
    }
  }

  function toggleCode(code: string, checked: boolean) {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function toggleGroup(codes: string[], checked: boolean) {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (checked) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  }

  async function savePermissions() {
    setSavingPerms(true);
    setPermsError(null);
    try {
      onRoleUpdated(await setRolePermissions(role.id, Array.from(selectedCodes)));
    } catch (err) {
      setPermsError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSavingPerms(false);
    }
  }

  async function refreshRoleUserCount() {
    try {
      onRoleUpdated(await getRole(role.id));
    } catch {
      /* non-critical — the userCount/permission badges just stay stale until the next full list reload */
    }
  }

  async function handleRemoveUser(u: UserListItem) {
    if (!window.confirm(`Bỏ vai trò "${role.name}" khỏi ${u.displayName ?? u.email}?`)) return;
    setUsersError(null);
    try {
      await applyRoleToUser(u.id, role.id, false, allRoles);
      reloadUsers();
      await refreshRoleUserCount();
    } catch (err) {
      setUsersError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function handleDelete() {
    if (role.isSystem) return;
    if (!window.confirm(`Xóa vai trò "${role.name}"? Không thể hoàn tác.`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRole(role.id);
      onRoleDeleted();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  const groups = groupPermissions(permissions);
  const users = usersResult?.items ?? null;

  return (
    <div className="max-w-4xl">
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 mb-2">
        ← Quay lại danh sách
      </button>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
            {role.name}
            <span className="font-mono text-sm text-gray-400">{role.code}</span>
            {role.isSystem && (
              <span className="px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-500 text-xs font-medium">
                Hệ thống
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {role.userCount} người dùng · {role.permissionCodes.length} quyền
          </p>
        </div>
        <span title={role.isSystem ? 'Không thể xóa vai trò hệ thống' : undefined}>
          <button
            onClick={() => void handleDelete()}
            disabled={role.isSystem || deleting}
            className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            {deleting ? 'Đang xóa...' : 'Xóa vai trò'}
          </button>
        </span>
      </div>

      {deleteError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-4">{deleteError}</div>}

      <form onSubmit={saveInfo} className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3 mb-6">
        <h2 className="text-base font-semibold text-gray-900">Thông tin</h2>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tên vai trò</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Mô tả</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        {infoError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{infoError}</div>}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingInfo}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {savingInfo ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </form>

      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold text-gray-900">Quyền ({selectedCodes.size})</h2>
          <button
            onClick={() => void savePermissions()}
            disabled={savingPerms}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {savingPerms ? 'Đang lưu...' : 'Lưu quyền'}
          </button>
        </div>
        {permsError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{permsError}</div>}
        {groups.length === 0 && <p className="text-sm text-gray-500">Chưa có quyền nào trong catalog.</p>}
        <div className="space-y-4 max-h-[28rem] overflow-y-auto pr-1">
          {groups.map(([group, perms]) => {
            const allChecked = perms.every((p) => selectedCodes.has(p.code));
            const someChecked = perms.some((p) => selectedCodes.has(p.code));
            return (
              <div key={group} className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el: HTMLInputElement | null) => {
                        if (el) el.indeterminate = !allChecked && someChecked;
                      }}
                      onChange={(e) => toggleGroup(perms.map((p) => p.code), e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    {group}
                  </label>
                  <span className="text-xs text-gray-400">
                    {perms.filter((p) => selectedCodes.has(p.code)).length}/{perms.length}
                  </span>
                </div>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {perms.map((p) => (
                    <label key={p.id} className="flex items-start gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={selectedCodes.has(p.code)}
                        onChange={(e) => toggleCode(p.code, e.target.checked)}
                        className="rounded border-gray-300 mt-0.5"
                      />
                      <span>
                        <span className="font-mono text-xs text-gray-500">{p.code}</span>
                        {p.description && <span className="block text-xs text-gray-400">{p.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Người dùng có vai trò này</h2>
          <button
            onClick={() => setAddUserOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
          >
            + Thêm người
          </button>
        </div>
        {usersError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{usersError}</div>}
        {users === null && !usersError && <p className="text-sm text-gray-500">Đang tải...</p>}
        {users && users.length === 0 && <p className="text-sm text-gray-500">Chưa có người dùng nào có vai trò này.</p>}
        {users && users.length > 0 && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4">Người dùng</th>
                <th className="py-2 pr-4">Trạng thái</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4">
                    <div className="text-gray-900 font-medium">{u.displayName ?? u.email}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </td>
                  <td className="py-2 pr-4 text-gray-500">{u.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}</td>
                  <td className="py-2 pr-4 text-right">
                    <button onClick={() => void handleRemoveUser(u)} className="text-red-600 hover:text-red-800 font-medium text-xs">
                      Bỏ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager
          meta={usersResult?.meta}
          itemLabel="người dùng"
          onPageChange={setUsersPage}
          pageSize={usersPageSize}
          onPageSizeChange={(size) => {
            setUsersPageSize(size);
            setUsersPage(1);
          }}
        />
      </div>

      {addUserOpen && (
        <AddUserToRoleModal
          role={role}
          allRoles={allRoles}
          onClose={() => setAddUserOpen(false)}
          onAdded={() => {
            setAddUserOpen(false);
            reloadUsers();
            void refreshRoleUserCount();
          }}
        />
      )}
    </div>
  );
}

/**
 * Search-as-you-type user picker — same pattern as
 * `CampaignAssignmentsPanel.tsx`'s `AssignUserModal` (debounced 300ms
 * against `GET /v1/users`), plus an extra check the kiosk-assignment picker
 * doesn't need: fetching the selected user's current roles up front so the
 * "already has this role" case can be caught and blocked before submit,
 * rather than silently no-op'ing (`applyRoleToUser`'s `Set` would just
 * re-add an id already present).
 */
function AddUserToRoleModal({
  role,
  allRoles,
  onClose,
  onAdded,
}: {
  role: Role;
  allRoles: Role[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserListItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserListItem | null>(null);
  const [alreadyHasRole, setAlreadyHasRole] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchError(null);
      listUsers({ q: q.trim() || undefined, limit: 20 })
        .then((res) => setResults(res.items))
        .catch((err) => setSearchError(err instanceof ApiError ? err.message : String(err)));
    }, 300);
    return () => clearTimeout(handle);
  }, [q]);

  async function selectUser(u: UserListItem) {
    setSelected(u);
    setSaveError(null);
    setChecking(true);
    try {
      const detail = await getUser(u.id);
      setAlreadyHasRole(detail.roleCodes.includes(role.code));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  const submit = async () => {
    if (!selected || alreadyHasRole) return;
    setSaving(true);
    setSaveError(null);
    try {
      await applyRoleToUser(selected.id, role.id, true, allRoles);
      onAdded();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Thêm người vào vai trò "${role.name}"`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tìm người dùng (email, tên, mã, hoặc SĐT)</label>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelected(null);
              setAlreadyHasRole(false);
            }}
            placeholder="Nhập để tìm..."
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            autoFocus
          />
        </div>

        {searchError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{searchError}</div>}

        {!searchError && (
          <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
            {results === null && <p className="p-3 text-sm text-gray-500">Đang tải...</p>}
            {results !== null && results.length === 0 && (
              <p className="p-3 text-sm text-gray-500">Không tìm thấy người dùng nào.</p>
            )}
            {results?.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => void selectUser(u)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${selected?.id === u.id ? 'bg-blue-50' : ''}`}
              >
                <div className="text-gray-900 font-medium">{u.displayName ?? u.email}</div>
                <div className="text-xs text-gray-500">
                  {u.email}
                  {u.code ? ` · ${u.code}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}

        {selected && checking && <p className="text-xs text-gray-500">Đang kiểm tra vai trò hiện có...</p>}
        {selected && !checking && alreadyHasRole && (
          <p className="text-xs text-amber-700">{selected.displayName ?? selected.email} đã có vai trò này rồi.</p>
        )}

        {saveError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{saveError}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!selected || alreadyHasRole || checking || saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang thêm...' : 'Thêm vào vai trò'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
