import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  IdentificationMethod,
  Paginated,
  createIdentificationMethod,
  listIdentificationMethodsPaginated,
  updateIdentificationMethod,
} from '../api';
import { DEFAULT_PAGE_SIZE, Pager } from '../components/Pager';
import { ModalShell } from '../components/CampaignDangerActions';

/**
 * "Phương thức định danh" catalog management. Create/edit opens as a
 * `ModalShell` overlay (same pattern `CardTemplatesPage.tsx`/`WorkflowsPage.tsx`
 * use) rather than swapping the whole page out for the form — plan item 3,
 * 2026-09-17. Backs `WorkflowConfigEditor.tsx`'s identification-methods
 * multi-select — a workflow only ever REFERENCES a method by its `code`,
 * never edits one inline, so this catalog needs its own screen.
 *
 * No hard delete exists server-side (`IdentificationMethodController` has
 * no `DELETE`) — retiring a method is `active: false` via the same form,
 * same convention `PhotoKindsPage` already uses for its own catalog.
 */
export function IdentificationMethodsPage() {
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState<Paginated<IdentificationMethod> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IdentificationMethod | null>(null);

  const reload = () => {
    listIdentificationMethodsPaginated({ page, limit: pageSize, includeInactive, q: q.trim() || undefined })
      .then(setResult)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, [page, pageSize, q, includeInactive]);

  const methods = result?.items ?? null;

  const updateRow = (updated: IdentificationMethod) => {
    setResult((prev) => (prev ? { ...prev, items: prev.items.map((m) => (m.id === updated.id ? updated : m)) } : prev));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Phương thức định danh</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Danh mục cách sinh viên tự định danh tại kiosk (quét QR CCCD, OCR, RFID...) — một workflow chọn một hoặc
            nhiều phương thức từ danh mục này.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
        >
          + Thêm phương thức
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo mã hoặc tên..."
          className="flex-1 min-w-[200px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => {
              setIncludeInactive(e.target.checked);
              setPage(1);
            }}
            className="rounded border-gray-300"
          />
          Hiện cả đã tắt
        </label>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}
      {methods === null && !error && <p className="text-gray-500">Đang tải...</p>}

      {methods && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Mã</th>
                <th className="text-left px-4 py-2.5">Tên hiển thị</th>
                <th className="text-left px-4 py-2.5">Cần phần cứng</th>
                <th className="text-left px-4 py-2.5">Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...methods].sort((a, b) => a.sortOrder - b.sortOrder).map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{m.code}</td>
                  <td className="px-4 py-2.5 text-gray-700">{m.nameVi}</td>
                  <td className="px-4 py-2.5 text-gray-500">{m.requiresHardware ? 'Có' : 'Không'}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`px-2 py-0.5 rounded-full border text-xs font-medium ${
                        m.active ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 border-gray-200 text-gray-500'
                      }`}
                    >
                      {m.active ? 'Đang dùng' : 'Đã tắt'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(m);
                        setFormOpen(true);
                      }}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                    >
                      Sửa
                    </button>
                  </td>
                </tr>
              ))}
              {methods.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    Chưa có phương thức định danh nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Pager
        meta={result?.meta}
        itemLabel="phương thức"
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {formOpen && (
        <IdentificationMethodForm
          method={editing}
          onClose={() => setFormOpen(false)}
          onSaved={(saved) => {
            setFormOpen(false);
            if (editing) {
              updateRow(saved);
            } else {
              reload();
            }
          }}
        />
      )}
    </div>
  );
}

function IdentificationMethodForm({
  method,
  onClose,
  onSaved,
}: {
  method: IdentificationMethod | null;
  onClose: () => void;
  onSaved: (method: IdentificationMethod) => void;
}) {
  const [code, setCode] = useState(method?.code ?? '');
  const [nameVi, setNameVi] = useState(method?.nameVi ?? '');
  const [description, setDescription] = useState(method?.description ?? '');
  const [requiresHardware, setRequiresHardware] = useState(method?.requiresHardware ?? false);
  const [active, setActive] = useState(method?.active ?? true);
  const [sortOrder, setSortOrder] = useState(String(method?.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = method
        ? await updateIdentificationMethod(method.id, {
            nameVi: nameVi.trim(),
            description: description.trim() || undefined,
            requiresHardware,
            active,
            sortOrder: Number(sortOrder) || 0,
          })
        : await createIdentificationMethod({
            code: code.trim(),
            nameVi: nameVi.trim(),
            description: description.trim() || undefined,
            requiresHardware,
            active,
            sortOrder: Number(sortOrder) || 0,
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={method ? 'Sửa phương thức định danh' : 'Thêm phương thức định danh'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Mã{method ? ' (không đổi được)' : ''}</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={!!method}
            placeholder="OCR_CCCD"
            required
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tên hiển thị</label>
          <input
            value={nameVi}
            onChange={(e) => setNameVi(e.target.value)}
            required
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Mô tả</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={requiresHardware} onChange={(e) => setRequiresHardware(e.target.checked)} className="rounded border-gray-300" />
            Cần phần cứng riêng
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded border-gray-300" />
            Đang dùng
          </label>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Thứ tự hiển thị</label>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-32 bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !nameVi.trim() || !code.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            Huỷ
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
