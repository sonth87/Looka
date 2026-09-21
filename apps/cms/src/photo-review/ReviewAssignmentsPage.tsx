import { useEffect, useState } from 'react';
import { useMemo } from 'react';
import {
  ApiError,
  ReviewAssignment,
  ReviewAssignmentGroupField,
  UserListItem,
  createReviewAssignment,
  deleteReviewAssignment,
  listReviewAssignmentGroupValues,
  listReviewAssignments,
  listUsers,
} from '../api';
import { ModalShell } from '../components/CampaignDangerActions';

const GROUP_FIELD_LABEL: Record<ReviewAssignmentGroupField, string> = {
  className: 'Lớp',
  faculty: 'Khoa',
  major: 'Ngành',
};

/**
 * "Phân công duyệt" — plan §5.2, feature 13. A user with ZERO rows here is
 * UNRESTRICTED (sees/acts on every set); rows here only ever NARROW
 * visibility to matching `className`/`faculty`/`major` values. Route
 * `/review/assignments`, linked from `ReviewListPage`'s header (same
 * "own route, own screen" precedent as `RolesPage`/`UsersPage`) and from
 * `Layout.tsx`'s nav, grouped with the other "Duyệt ảnh" links.
 *
 * Write actions (create/delete) are ADMIN only server-side
 * (`ReviewAssignmentController`) — this page does not try to hide itself
 * from non-admins client-side (same "server enforces, nav doesn't gate"
 * precedent `/roles` already follows); a non-admin who opens it just gets a
 * read-only list of their own assignments and a 403 if they try to add/remove.
 */
export function ReviewAssignmentsPage() {
  const [assignments, setAssignments] = useState<ReviewAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = () => {
    setError(null);
    listReviewAssignments()
      .then(setAssignments)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, []);

  const byUser = useMemo(() => {
    const map = new Map<string, { userId: string; userName?: string; rows: ReviewAssignment[] }>();
    for (const a of assignments ?? []) {
      const entry = map.get(a.userId) ?? { userId: a.userId, userName: a.userName, rows: [] };
      entry.rows.push(a);
      map.set(a.userId, entry);
    }
    return Array.from(map.values()).sort((x, y) => (x.userName ?? x.userId).localeCompare(y.userName ?? y.userId));
  }, [assignments]);

  async function handleDelete(a: ReviewAssignment) {
    if (!window.confirm(`Bỏ phân công "${GROUP_FIELD_LABEL[a.groupField]}: ${a.groupValue}" khỏi ${a.userName ?? a.userId}?`))
      return;
    setDeletingId(a.id);
    setError(null);
    try {
      await deleteReviewAssignment(a.id);
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
            Chỉ được duyệt hồ sơ thuộc lớp/khoa/ngành đã phân công. Người chưa có phân công nào thì được duyệt tất cả.
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
      {assignments === null && !error && <p className="text-gray-500">Đang tải...</p>}
      {assignments && assignments.length === 0 && (
        <p className="text-gray-500">Chưa có phân công nào — mọi người đang được duyệt tất cả hồ sơ.</p>
      )}

      {byUser.length > 0 && (
        <div className="space-y-4">
          {byUser.map((entry) => (
            <div key={entry.userId} className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="font-medium text-gray-900 mb-2">{entry.userName ?? entry.userId}</div>
              <div className="flex flex-wrap gap-2">
                {entry.rows.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border border-gray-200 bg-gray-50 text-gray-700 text-xs font-medium"
                  >
                    {GROUP_FIELD_LABEL[a.groupField]}: {a.groupValue}
                    <button
                      type="button"
                      onClick={() => void handleDelete(a)}
                      disabled={deletingId === a.id}
                      aria-label={`Bỏ phân công ${a.groupValue}`}
                      className="hover:text-red-600 disabled:opacity-40"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
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
    </div>
  );
}

/** Search-as-you-type single-select user picker + group field/value pickers — one submit grants one `(userId, groupField, groupValue)` row. */
function AddAssignmentModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserListItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);

  const [groupField, setGroupField] = useState<ReviewAssignmentGroupField>('faculty');
  const [groupValue, setGroupValue] = useState('');
  const [valueOptions, setValueOptions] = useState<string[]>([]);

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

  useEffect(() => {
    setGroupValue('');
    listReviewAssignmentGroupValues(groupField)
      .then(setValueOptions)
      .catch(() => setValueOptions([]));
  }, [groupField]);

  const submit = async () => {
    if (!selectedUser || !groupValue.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await createReviewAssignment({ userId: selectedUser.id, groupField, groupValue: groupValue.trim() });
      onAdded();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Thêm phân công duyệt" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Người được phân công</label>
          {selectedUser ? (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-sm">
              <span className="text-gray-900 font-medium">{selectedUser.displayName ?? selectedUser.email}</span>
              <button type="button" onClick={() => setSelectedUser(null)} className="text-gray-500 hover:text-red-600">
                Đổi
              </button>
            </div>
          ) : (
            <>
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
                  {results !== null && results.length === 0 && (
                    <p className="p-3 text-sm text-gray-500">Không tìm thấy người dùng nào.</p>
                  )}
                  {results?.map((u) => (
                    <button
                      type="button"
                      key={u.id}
                      onClick={() => setSelectedUser(u)}
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
            </>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Trường nhóm</label>
          <select
            value={groupField}
            onChange={(e) => setGroupField(e.target.value as ReviewAssignmentGroupField)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            {(Object.keys(GROUP_FIELD_LABEL) as ReviewAssignmentGroupField[]).map((f) => (
              <option key={f} value={f}>
                {GROUP_FIELD_LABEL[f]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Giá trị (vd "Khoa CNTT")</label>
          <input
            value={groupValue}
            onChange={(e) => setGroupValue(e.target.value)}
            list="review-assignment-group-values"
            placeholder="Nhập hoặc chọn từ danh sách"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
          <datalist id="review-assignment-group-values">
            {valueOptions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>

        {saveError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{saveError}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!selectedUser || !groupValue.trim() || saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Thêm phân công'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
