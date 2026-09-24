import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  CreateUserInput,
  Paginated,
  Role,
  UserListItem,
  UserSource,
  createUser,
  listRoles,
  listUsers,
} from '../api';
import { DEFAULT_PAGE_SIZE, Pager } from './Pager';
import { ModalShell } from './CampaignDangerActions';

const STATUS_OPTIONS: Array<'ACTIVE' | 'DISABLED'> = ['ACTIVE', 'DISABLED'];
const STATUS_LABEL: Record<'ACTIVE' | 'DISABLED', string> = { ACTIVE: 'Hoạt động', DISABLED: 'Đã khóa' };
const SOURCE_OPTIONS: UserSource[] = ['SSO', 'MANUAL', 'SYNC'];
const SOURCE_LABEL: Record<UserSource, string> = {
  SSO: 'Đăng nhập SSO',
  MANUAL: 'Tạo tay (chưa đăng nhập)',
  SYNC: 'Đồng bộ hệ thống khác',
};

/**
 * "Người dùng" (`/users`) — plan item 12, 2026-09-17: a standalone,
 * filterable list page never existed before this; the only place a user
 * could be found was `RolesPage.tsx`'s small search-only picker (used to
 * add someone to a role). Read-only browsing/filtering here — role
 * assignment itself stays owned by `RolesPage.tsx` (`AddUserToRoleModal`)
 * so mutation logic doesn't end up duplicated in two places.
 *
 * `listUsers`'s `roleCode`/`status`/`source` filters were already supported
 * server-side (`ListUsersQueryDto`) but never wired into any CMS UI before
 * this page — see `api.ts`'s own doc comment on `UserListItem`.
 */
export function UsersPage() {
  const [q, setQ] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'DISABLED' | ''>('');
  const [source, setSource] = useState<UserSource | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState<Paginated<UserListItem> | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const reload = () => {
    setError(null);
    listUsers({
      q: q.trim() || undefined,
      roleCode: roleCode || undefined,
      status: status || undefined,
      source: source || undefined,
      page,
      limit: pageSize,
    })
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(() => {
    listRoles().then(setRoles).catch(() => {});
  }, []);

  useEffect(reload, [q, roleCode, status, source, page, pageSize]);

  const users = result?.items ?? [];
  const roleName = (code: string) => roles.find((r) => r.code === code)?.name ?? code;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Người dùng</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Toàn bộ người dùng trong hệ thống — gán/bỏ vai trò ở trang{' '}
            <a href="/roles" className="text-blue-600 hover:text-blue-800 underline">
              Phân quyền
            </a>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shrink-0"
        >
          Thêm người dùng
        </button>
      </div>

      <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm mb-4 flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo email, tên, mã, hoặc SĐT..."
          className="flex-1 min-w-[200px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        />
        <select
          value={roleCode}
          onChange={(e) => {
            setRoleCode(e.target.value);
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả vai trò</option>
          {roles.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'ACTIVE' | 'DISABLED' | '');
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả trạng thái</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value as UserSource | '');
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả nguồn</option>
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Tên / Email</th>
              <th className="text-left px-4 py-2.5">Mã</th>
              <th className="text-left px-4 py-2.5">SĐT</th>
              <th className="text-left px-4 py-2.5">Vai trò</th>
              <th className="text-left px-4 py-2.5">Trạng thái</th>
              <th className="text-left px-4 py-2.5">Nguồn</th>
              <th className="text-left px-4 py-2.5">Đăng nhập cuối</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-gray-900">{u.displayName ?? '—'}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="px-4 py-2.5 text-gray-500">{u.code ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-500">{u.phone ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {u.roleCodes.length === 0 && <span className="text-gray-400 text-xs">— chưa có —</span>}
                    {u.roleCodes.map((code) => (
                      <span key={code} className="px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-600 text-xs">
                        {roleName(code)}
                      </span>
                    ))}
                    {u.isAdmin && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
                        Admin
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`px-2 py-0.5 rounded-full border text-xs font-medium ${
                      u.status === 'ACTIVE'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-gray-50 border-gray-200 text-gray-500'
                    }`}
                  >
                    {STATUS_LABEL[u.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">{SOURCE_LABEL[u.source]}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('vi-VN') : '— chưa đăng nhập —'}
                </td>
              </tr>
            ))}
            {users.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  Không tìm thấy người dùng nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        meta={result?.meta}
        itemLabel="người dùng"
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {showCreateModal && (
        <CreateUserModal
          roles={roles}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            setPage(1);
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * "Thêm người dùng" (plan item — bổ sung tạo tay từ CMS, backend
 * `POST /v1/users` đã có sẵn từ P1 2026-09-14 nhưng chưa có form trên CMS).
 * Vai trò để trống được, gán sau qua trang Phân quyền — khớp
 * `CreateUserDto`'s own doc comment "để trống để phân quyền sau".
 */
function CreateUserModal({
  roles,
  onClose,
  onCreated,
}: {
  roles: Role[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [faculty, setFaculty] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRole = (id: string) => {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !email.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const input: CreateUserInput = {
        displayName: displayName.trim(),
        email: email.trim(),
        title: title.trim() || undefined,
        phone: phone.trim() || undefined,
        department: department.trim() || undefined,
        faculty: faculty.trim() || undefined,
        roleIds: roleIds.length > 0 ? roleIds : undefined,
      };
      await createUser(input);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Thêm người dùng" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Họ tên</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Chức vụ</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Số điện thoại</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Phòng ban</label>
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Khoa</label>
            <input
              value={faculty}
              onChange={(e) => setFaculty(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Vai trò (có thể để trống, gán sau)</label>
          <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
            {roles.length === 0 && <div className="text-xs text-gray-400 px-1">Chưa có vai trò nào.</div>}
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm px-1 py-0.5">
                <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} className="rounded border-gray-300" />
                {r.name}
              </label>
            ))}
          </div>
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
            {saving ? 'Đang lưu...' : 'Thêm người dùng'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
