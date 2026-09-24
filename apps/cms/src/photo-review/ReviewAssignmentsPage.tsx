import { useEffect, useRef, useState } from 'react';
import { useMemo } from 'react';
import {
  ApiError,
  Reviewer,
  ReviewAssignment,
  ReviewAssignmentGroupField,
  Role,
  UserListItem,
  deleteReviewAssignment,
  grantReviewer,
  listReviewAssignments,
  listReviewers,
  listRoles,
  listUsers,
  revokeReviewer,
} from '../api';
import { ModalShell } from '../components/CampaignDangerActions';

const GROUP_FIELD_LABEL: Record<ReviewAssignmentGroupField, string> = {
  className: 'Lớp',
  faculty: 'Khoa',
  major: 'Ngành',
};

/**
 * "Phân công duyệt" — plan §5.2, feature 13. Two independent grant kinds
 * shown here:
 *
 * 1. "Người có quyền duyệt" (`Reviewer`, `users.roles` contains
 *    `'REVIEWER'`) — UNRESTRICTED, sees/acts on every set. This is what
 *    "+ Thêm phân công" grants as of 2026-09-22 (product ask: adding
 *    someone should only need picking a person, not a group
 *    field/value) — see `AddReviewerModal` below.
 * 2. "Phân công theo nhóm" (`ReviewAssignment` rows) — the older, narrower
 *    grant: `(userId, groupField, groupValue)`, only ever NARROWS
 *    visibility for a person who already has REVIEWER access some other
 *    way. No longer creatable from this page (no UI produces new rows
 *    here anymore), but existing rows still apply server-side
 *    (`ReviewAssignmentService.assertInScope`/`buildScopeFilter`) and stay
 *    listed/removable here so old grants aren't stranded.
 *
 * Route `/review/assignments`, linked from `ReviewListPage`'s header (same
 * "own route, own screen" precedent as `RolesPage`/`UsersPage`) and from
 * `Layout.tsx`'s nav, grouped with the other "Duyệt ảnh" links.
 *
 * Write actions (grant/revoke reviewer, delete assignment) are ADMIN only
 * server-side (`ReviewAssignmentController`) — this page does not try to
 * hide itself from non-admins client-side (same "server enforces, nav
 * doesn't gate" precedent `/roles` already follows); a non-admin who opens
 * it just gets a read-only list of their own scoped assignments (the
 * reviewers list itself is admin-only, so it renders empty/error for them)
 * and a 403 if they try to add/remove.
 */
export function ReviewAssignmentsPage() {
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null);
  const [assignments, setAssignments] = useState<ReviewAssignment[] | null>(null);
  // "Thông tin người dùng cần hiển thị nhiều hơn... role gì" (2026-09-22) —
  // `roleCodes` on `Reviewer`/`ReviewAssignment` are RBAC codes (e.g.
  // "REVIEWER_ADMIN"); this maps them to the human `Role.name` the same way
  // `UsersPage.tsx`'s own `roleName` helper does.
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);
  // Confirm dialogs (2026-09-22: "xóa ... cần dạng table list và có dialog
  // confirm" — replaces the old `window.confirm()` native popup) — holding
  // the target row opens the dialog, `null` closes it.
  const [confirmRevoke, setConfirmRevoke] = useState<Reviewer | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ReviewAssignment | null>(null);
  // Bumped on every `reload()` call; a response only gets applied if it's
  // still the latest one requested — two rapid `reload()`s (e.g. deleting
  // two chips back to back) can otherwise resolve out of order and let a
  // stale, already-superseded list overwrite the current one.
  const reloadSeqRef = useRef(0);

  const reload = () => {
    const seq = ++reloadSeqRef.current;
    setError(null);
    listReviewAssignments()
      .then((data) => {
        if (seq !== reloadSeqRef.current) return;
        setAssignments(data);
      })
      .catch((err) => {
        if (seq !== reloadSeqRef.current) return;
        setError(err instanceof ApiError ? err.message : String(err));
      });
    listReviewers()
      .then((data) => {
        if (seq !== reloadSeqRef.current) return;
        setReviewers(data);
      })
      .catch((err) => {
        if (seq !== reloadSeqRef.current) return;
        setError(err instanceof ApiError ? err.message : String(err));
      });
  };

  useEffect(reload, []);
  useEffect(() => {
    listRoles().then(setRoles).catch(() => {});
  }, []);

  const roleName = (code: string) => roles.find((r) => r.code === code)?.name ?? code;

  async function confirmRevokeReviewer() {
    if (!confirmRevoke) return;
    const r = confirmRevoke;
    setRevokingUserId(r.userId);
    setError(null);
    try {
      await revokeReviewer(r.userId);
      setConfirmRevoke(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRevokingUserId(null);
    }
  }

  const sortedAssignments = useMemo(
    () =>
      [...(assignments ?? [])].sort(
        (x, y) => (x.userName ?? x.userId).localeCompare(y.userName ?? y.userId) || x.groupValue.localeCompare(y.groupValue),
      ),
    [assignments],
  );

  async function confirmDeleteAssignment() {
    if (!confirmDelete) return;
    const a = confirmDelete;
    setDeletingId(a.id);
    setError(null);
    try {
      await deleteReviewAssignment(a.id);
      setConfirmDelete(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Phân công duyệt</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Người có quyền duyệt bên dưới được duyệt TẤT CẢ hồ sơ. Người chưa được cấp thì không vào được mục Duyệt ảnh.
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shrink-0"
        >
          + Thêm phân công
        </button>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm mb-4 overflow-hidden">
        <h2 className="text-sm font-semibold text-gray-900 px-4 pt-4">Người có quyền duyệt</h2>
        {reviewers === null && !error && <p className="text-sm text-gray-500 px-4 py-4">Đang tải...</p>}
        {reviewers && reviewers.length === 0 && <p className="text-sm text-gray-500 px-4 py-4">Chưa cấp quyền duyệt cho ai.</p>}
        {reviewers && reviewers.length > 0 && (
          <table className="w-full text-sm mt-2">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Người dùng</th>
                <th className="text-left px-4 py-2.5">Phòng ban</th>
                <th className="text-left px-4 py-2.5">Khoa</th>
                <th className="text-left px-4 py-2.5">Vai trò</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reviewers.map((r) => (
                <tr key={r.userId} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <UserInfoCell name={r.userName} userId={r.userId} email={r.userEmail} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{r.userDepartment ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.userFaculty ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <RoleBadges codes={r.userRoleCodes} roleName={roleName} />
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setConfirmRevoke(r)}
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
                      Gỡ quyền
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sortedAssignments.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <h2 className="text-sm font-semibold text-gray-900 px-4 pt-4">Phân công theo nhóm (giới hạn, không tạo mới được nữa)</h2>
          <table className="w-full text-sm mt-2">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Người dùng</th>
                <th className="text-left px-4 py-2.5">Phòng ban</th>
                <th className="text-left px-4 py-2.5">Khoa</th>
                <th className="text-left px-4 py-2.5">Vai trò</th>
                <th className="text-left px-4 py-2.5">Trường nhóm</th>
                <th className="text-left px-4 py-2.5">Giá trị</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedAssignments.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <UserInfoCell name={a.userName} userId={a.userId} email={a.userEmail} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{a.userDepartment ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{a.userFaculty ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <RoleBadges codes={a.userRoleCodes ?? []} roleName={roleName} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{GROUP_FIELD_LABEL[a.groupField]}</td>
                  <td className="px-4 py-2.5 text-gray-500">{a.groupValue}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(a)}
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <AddAssignmentModal
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            reload();
          }}
        />
      )}

      {confirmRevoke && (
        <ConfirmDialog
          title="Gỡ quyền duyệt"
          message={`Gỡ quyền duyệt của "${confirmRevoke.userName ?? confirmRevoke.userId}"? Người này sẽ không vào được mục Duyệt ảnh nữa (trừ khi vẫn còn phân công theo nhóm khác).`}
          confirmLabel="Gỡ quyền"
          busy={revokingUserId === confirmRevoke.userId}
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => void confirmRevokeReviewer()}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Bỏ phân công"
          message={`Bỏ phân công "${GROUP_FIELD_LABEL[confirmDelete.groupField]}: ${confirmDelete.groupValue}" khỏi "${confirmDelete.userName ?? confirmDelete.userId}"?`}
          confirmLabel="Bỏ phân công"
          busy={deletingId === confirmDelete.id}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void confirmDeleteAssignment()}
        />
      )}
    </div>
  );
}

/** Name (bold) + email (small, gray) — same two-line cell shape `UsersPage.tsx`'s own user column already uses. */
function UserInfoCell({ name, userId, email }: { name?: string; userId: string; email?: string }) {
  return (
    <>
      <div className="font-medium text-gray-900">{name ?? userId}</div>
      {email && <div className="text-xs text-gray-500">{email}</div>}
    </>
  );
}

/** RBAC role codes as small pills, resolved to their human `Role.name` — same badge shape `UsersPage.tsx`'s own role column already uses. */
function RoleBadges({ codes, roleName }: { codes: string[]; roleName: (code: string) => string }) {
  if (codes.length === 0) return <span className="text-gray-400 text-xs">— chưa có —</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {codes.map((code) => (
        <span key={code} className="px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-600 text-xs">
          {roleName(code)}
        </span>
      ))}
    </div>
  );
}

/** Shared "are you sure" dialog — replaces the old `window.confirm()` native popup (2026-09-22) with one that matches the rest of the app's modal style. */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onCancel}>
      <div className="space-y-4">
        <p className="text-sm text-gray-700">{message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
            Huỷ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {busy ? 'Đang xử lý...' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * Search-as-you-type MULTI-select user picker (2026-09-22: "cần chọn nhiều
 * người" — one open of this modal can grant several people at once) — each
 * submit grants every selected user unrestricted REVIEWER access
 * (`grantReviewer`), one call per person. Simplified the same day from the
 * old groupField/groupValue-picking form: adding someone here no longer
 * creates a scoped `ReviewAssignment` row, see this file's own top doc
 * comment.
 */
function AddAssignmentModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserListItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<UserListItem[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // `cancelled` is captured by the timeout callback's closures below, and
    // flipped by this effect's cleanup — covers BOTH cases: the timer
    // hasn't fired yet (cleared outright) and the timer already fired and
    // `listUsers()` is in flight (its resolution is just ignored), so a
    // slower earlier keystroke's response can never overwrite a faster
    // later one.
    let cancelled = false;
    const handle = setTimeout(() => {
      setSearchError(null);
      listUsers({ q: q.trim() || undefined, limit: 20 })
        .then((res) => {
          if (cancelled) return;
          setResults(res.items);
        })
        .catch((err) => {
          if (cancelled) return;
          setSearchError(err instanceof ApiError ? err.message : String(err));
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q]);

  const addUser = (u: UserListItem) => {
    setSelectedUsers((prev) => (prev.some((s) => s.id === u.id) ? prev : [...prev, u]));
  };
  const removeUser = (id: string) => {
    setSelectedUsers((prev) => prev.filter((s) => s.id !== id));
  };

  const submit = async () => {
    if (selectedUsers.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Sequential, not `Promise.all` — a partial failure mid-batch should
      // still leave the earlier grants applied (each `grantReviewer` call
      // is its own idempotent write) rather than an all-or-nothing race
      // where the caller can't tell which ones actually landed.
      for (const u of selectedUsers) {
        await grantReviewer(u.id);
      }
      onAdded();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const visibleResults = (results ?? []).filter((u) => !selectedUsers.some((s) => s.id === u.id));

  return (
    <ModalShell title="Thêm phân công duyệt" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Người được cấp quyền duyệt (không giới hạn)</label>

          {selectedUsers.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selectedUsers.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-800 text-xs font-medium"
                >
                  {u.displayName ?? u.email}
                  <button
                    type="button"
                    onClick={() => removeUser(u.id)}
                    aria-label={`Bỏ chọn ${u.displayName ?? u.email}`}
                    className="hover:text-red-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo email, tên, mã, SĐT..."
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            autoFocus
          />
          {searchError && (
            <div className="mt-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{searchError}</div>
          )}
          {!searchError && (
            <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {results === null && <p className="p-3 text-sm text-gray-500">Đang tải...</p>}
              {results !== null && visibleResults.length === 0 && (
                <p className="p-3 text-sm text-gray-500">
                  {results.length === 0 ? 'Không tìm thấy người dùng nào.' : 'Đã chọn hết kết quả tìm được.'}
                </p>
              )}
              {visibleResults.map((u) => (
                <button
                  type="button"
                  key={u.id}
                  onClick={() => addUser(u)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
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
        </div>

        {saveError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{saveError}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={selectedUsers.length === 0 || saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : `Cấp quyền duyệt${selectedUsers.length > 0 ? ` (${selectedUsers.length})` : ''}`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
