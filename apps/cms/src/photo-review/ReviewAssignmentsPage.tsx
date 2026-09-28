import { useEffect, useRef, useState } from 'react';
import { useMemo } from 'react';
import {
  ApiError,
  MyReviewCampaign,
  Reviewer,
  ReviewAssignment,
  ReviewAssignmentGroupField,
  Role,
  UserListItem,
  createReviewAssignment,
  deleteReviewAssignment,
  listMyReviewCampaigns,
  listReviewAssignmentGroupValues,
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

/** "Cả đợt" (whole-campaign) is represented client-side as `''`, mapped to omitting groupField/groupValue on the wire — see `AddAssignmentModal`. */
const GROUP_FIELD_OPTIONS: Array<{ value: '' | ReviewAssignmentGroupField; label: string }> = [
  { value: '', label: 'Cả đợt' },
  { value: 'className', label: 'Lớp' },
  { value: 'faculty', label: 'Khoa' },
  { value: 'major', label: 'Ngành' },
];

function formatGroup(a: Pick<ReviewAssignment, 'groupField' | 'groupValue'>): string {
  return a.groupField && a.groupValue ? `${GROUP_FIELD_LABEL[a.groupField]}: ${a.groupValue}` : 'Cả đợt';
}

/**
 * "Phân công duyệt" — plan §5.2, feature 13, PER-CAMPAIGN pivot 2026-09-28.
 * Two independent grant kinds shown here:
 *
 * 1. "Người có quyền duyệt" (`Reviewer`, `users.roles` contains
 *    `'REVIEWER'`) — the ROLE, a prerequisite for reaching the "Duyệt ảnh"
 *    UI at all, but no longer a guarantee of seeing anything: a REVIEWER
 *    with zero rows in the table below sees nothing in any campaign (the
 *    server's own strict rule, see `ReviewAssignment`'s doc comment on the
 *    API side). `createReviewAssignment` below auto-grants this role
 *    server-side, so the normal path to onboarding a new reviewer is now
 *    "+ Thêm phân công" (pick a campaign for them), not this table directly
 *    — "Gỡ quyền" here stays the explicit, separate "remove this person
 *    entirely" action (does NOT delete their assignment rows, which just go
 *    stale/inert once the role is gone).
 * 2. "Phân công theo đợt/nhóm" (`ReviewAssignment` rows) — the real gate:
 *    `(userId, campaignId, groupField?, groupValue?)`. Both group columns
 *    absent means "cả đợt chụp"; both present narrows to one Lớp/Khoa/Ngành
 *    within that campaign.
 *
 * Route `/review` (tab here, not its own route — see `ReviewListPage`'s own
 * doc comment on why). Write actions (grant/revoke reviewer, create/delete
 * assignment) are ADMIN only server-side (`ReviewAssignmentController`) —
 * this page does not try to hide itself from non-admins client-side (same
 * "server enforces, nav doesn't gate" precedent `/roles` already follows);
 * a non-admin who opens it just gets a read-only list of their own scoped
 * assignments and a 403 if they try to add/remove.
 */
export function ReviewAssignmentsPage() {
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null);
  const [assignments, setAssignments] = useState<ReviewAssignment[] | null>(null);
  const [campaigns, setCampaigns] = useState<MyReviewCampaign[]>([]);
  const [campaignFilter, setCampaignFilter] = useState('');
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
    listReviewAssignments(campaignFilter ? { campaignId: campaignFilter } : {})
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

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `reload` reads `campaignFilter` fresh on every call; re-running only when the FILTER itself changes (not on every `reload` identity change) is the intended behavior, same as the other list pages' filter effects in this app.
  useEffect(reload, [campaignFilter]);
  useEffect(() => {
    listRoles().then(setRoles).catch(() => {});
    // Admin sees every campaign here (server's own `isAdmin` bypass on
    // `myCampaigns` — see that endpoint's doc comment); a non-admin sees
    // only their own assigned campaigns, which is harmless here since they
    // cannot actually create/delete anyway (server-enforced).
    listMyReviewCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
  }, []);

  const roleName = (code: string) => roles.find((r) => r.code === code)?.name ?? code;
  const campaignName = (id: string) => campaigns.find((c) => c.campaignId === id)?.campaignName ?? id;

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
        (x, y) =>
          (x.userName ?? x.userId).localeCompare(y.userName ?? y.userId) ||
          (x.campaignName ?? x.campaignId).localeCompare(y.campaignName ?? y.campaignId),
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
            Người duyệt chỉ thấy ảnh của các đợt được phân công — chưa được phân công đợt nào thì không thấy hồ sơ nào, dù
            đã có quyền duyệt.
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
        <p className="text-xs text-gray-500 px-4 pt-1">
          Có quyền vào mục Duyệt ảnh — nhưng chỉ thấy hồ sơ của đợt nào được phân công ở bảng dưới.
        </p>
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

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 gap-3">
          <h2 className="text-sm font-semibold text-gray-900">Phân công theo đợt/nhóm</h2>
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-900"
          >
            <option value="">Tất cả đợt chụp</option>
            {campaigns.map((c) => (
              <option key={c.campaignId} value={c.campaignId}>
                {c.campaignName}
              </option>
            ))}
          </select>
        </div>
        {assignments === null && !error && <p className="text-sm text-gray-500 px-4 py-4">Đang tải...</p>}
        {assignments && sortedAssignments.length === 0 && (
          <p className="text-sm text-gray-500 px-4 py-4">Chưa có phân công nào{campaignFilter ? ' cho đợt này' : ''}.</p>
        )}
        {sortedAssignments.length > 0 && (
          <table className="w-full text-sm mt-2">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Người dùng</th>
                <th className="text-left px-4 py-2.5">Vai trò</th>
                <th className="text-left px-4 py-2.5">Đợt chụp</th>
                <th className="text-left px-4 py-2.5">Phạm vi</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedAssignments.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <UserInfoCell name={a.userName} userId={a.userId} email={a.userEmail} />
                  </td>
                  <td className="px-4 py-2.5">
                    <RoleBadges codes={a.userRoleCodes ?? []} roleName={roleName} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{a.campaignName ?? campaignName(a.campaignId)}</td>
                  <td className="px-4 py-2.5 text-gray-500">{formatGroup(a)}</td>
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
        )}
      </div>

      {addOpen && (
        <AddAssignmentModal
          campaigns={campaigns}
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
          message={`Gỡ quyền duyệt của "${confirmRevoke.userName ?? confirmRevoke.userId}"? Người này sẽ không vào được mục Duyệt ảnh nữa (các phân công đợt/nhóm hiện có vẫn còn nhưng không còn tác dụng cho đến khi được cấp lại quyền).`}
          confirmLabel="Gỡ quyền"
          busy={revokingUserId === confirmRevoke.userId}
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => void confirmRevokeReviewer()}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Bỏ phân công"
          message={`Bỏ phân công "${formatGroup(confirmDelete)}" của đợt "${confirmDelete.campaignName ?? campaignName(confirmDelete.campaignId)}" khỏi "${confirmDelete.userName ?? confirmDelete.userId}"? Quyền duyệt (nếu còn phân công khác) không bị ảnh hưởng.`}
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
 * Search-as-you-type MULTI-select user picker + campaign/group picker
 * (PER-CAMPAIGN pivot 2026-09-28, replacing the 2026-09-22 simplified
 * unrestricted-only flow this modal used to be — see this file's own top
 * doc comment). Every submit creates ONE `ReviewAssignment` per selected
 * user for the chosen `(campaignId, groupField?, groupValue?)` — each
 * `createReviewAssignment` call auto-grants the `REVIEWER` role server-side,
 * so there is no separate "grant role" step here anymore.
 */
function AddAssignmentModal({
  campaigns,
  onClose,
  onAdded,
}: {
  campaigns: MyReviewCampaign[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [campaignId, setCampaignId] = useState('');
  const [groupField, setGroupField] = useState<'' | ReviewAssignmentGroupField>('');
  const [groupValue, setGroupValue] = useState('');
  const [groupValueOptions, setGroupValueOptions] = useState<string[]>([]);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserListItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<UserListItem[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Group-value options are scoped to the chosen campaign's own roster —
  // reset both the selected value and the option list whenever no
  // campaign/group-field is chosen yet.
  useEffect(() => {
    if (!campaignId || !groupField) {
      setGroupValueOptions([]);
      return;
    }
    setGroupValue('');
    listReviewAssignmentGroupValues(groupField, campaignId)
      .then(setGroupValueOptions)
      .catch(() => setGroupValueOptions([]));
  }, [campaignId, groupField]);

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

  const canSubmit = campaignId && selectedUsers.length > 0 && (!groupField || !!groupValue);

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Sequential, not `Promise.all` — a partial failure mid-batch should
      // still leave the earlier grants applied (each `createReviewAssignment`
      // call is its own idempotent write) rather than an all-or-nothing race
      // where the caller can't tell which ones actually landed.
      for (const u of selectedUsers) {
        await createReviewAssignment({
          userId: u.id,
          campaignId,
          groupField: groupField || undefined,
          groupValue: groupField ? groupValue : undefined,
        });
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Đợt chụp</label>
            <select
              value={campaignId}
              onChange={(e) => {
                setCampaignId(e.target.value);
                setGroupField('');
                setGroupValue('');
              }}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            >
              <option value="">— Chọn đợt chụp —</option>
              {campaigns.map((c) => (
                <option key={c.campaignId} value={c.campaignId}>
                  {c.campaignName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Phạm vi</label>
            <select
              value={groupField}
              onChange={(e) => setGroupField(e.target.value as '' | ReviewAssignmentGroupField)}
              disabled={!campaignId}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:opacity-50"
            >
              {GROUP_FIELD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {groupField && (
          <div>
            <label className="block text-sm text-gray-500 mb-1">{GROUP_FIELD_LABEL[groupField]}</label>
            <select
              value={groupValue}
              onChange={(e) => setGroupValue(e.target.value)}
              disabled={groupValueOptions.length === 0}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:opacity-50"
            >
              <option value="">
                {groupValueOptions.length === 0 ? `— Không có dữ liệu ${GROUP_FIELD_LABEL[groupField].toLowerCase()} —` : `— Chọn ${GROUP_FIELD_LABEL[groupField].toLowerCase()} —`}
              </option>
              {groupValueOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-500 mb-1">Người được phân công</label>

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
            disabled={!canSubmit || saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : `Thêm phân công${selectedUsers.length > 0 ? ` (${selectedUsers.length})` : ''}`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
