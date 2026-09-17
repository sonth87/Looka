import { useEffect, useState } from 'react';
import {
  ApiError,
  Paginated,
  Role,
  UserListItem,
  UserSource,
  listRoles,
  listUsers,
} from '../api';
import { DEFAULT_PAGE_SIZE, Pager } from './Pager';

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

  useEffect(() => {
    listRoles().then(setRoles).catch(() => {});
  }, []);

  useEffect(() => {
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
  }, [q, roleCode, status, source, page, pageSize]);

  const users = result?.items ?? [];
  const roleName = (code: string) => roles.find((r) => r.code === code)?.name ?? code;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Người dùng</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Toàn bộ người dùng trong hệ thống — gán/bỏ vai trò ở trang{' '}
          <a href="/roles" className="text-blue-600 hover:text-blue-800 underline">
            Phân quyền
          </a>
          .
        </p>
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
    </div>
  );
}
