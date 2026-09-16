import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  Campaign,
  CardTemplate,
  PrintBatch,
  PrintBatchStatus,
  createPrintBatch,
  listCampaigns,
  listCardTemplates,
  listPrintBatches,
} from '../api';
import {
  PRINT_BATCH_STATUS_BADGE_CLASS,
  PRINT_BATCH_STATUS_LABEL,
} from './printFormat';

const BATCH_STATUS_OPTIONS: PrintBatchStatus[] = ['DRAFT', 'READY', 'PRINTING', 'DONE', 'CANCELLED'];

/**
 * "Quản lý in thẻ" (in-thẻ mockup) — Phase 2 of the CMS UI update. List of
 * print batches (đợt in); clicking a row navigates to its own routed detail
 * page (`/print/batches/:id`, `PrintBatchDetailPage.tsx`) — 2026-09-16, moved
 * off a local `selectedBatchId` modal so the detail view is a real
 * bookmarkable URL (see that file's own doc comment). Reuses `apps/api`'s
 * `print` module as-is (see `api.ts`'s own doc comment on this section).
 * Card-template CRUD/layout authoring lives on its own `/card-templates`
 * page now (Task C) — this screen only lists templates to pick a batch's
 * default one.
 */
export function PrintPage() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [statusFilter, setStatusFilter] = useState<PrintBatchStatus | ''>('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [batches, setBatches] = useState<PrintBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => {});
    listCardTemplates().then((r) => setTemplates(r.items)).catch(() => {});
  }, []);

  function reloadBatches() {
    setError(null);
    listPrintBatches({ status: statusFilter || undefined, campaignId: campaignFilter || undefined, limit: 50 })
      .then((r) => setBatches(r.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }

  useEffect(reloadBatches, [statusFilter, campaignFilter]);

  const campaignName = (id?: string | null) => campaigns.find((c) => c.id === id)?.name ?? id ?? '—';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Quản lý in thẻ</h1>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
        >
          + Tạo đợt in
        </button>
      </div>

      <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm mb-4 flex flex-wrap gap-3">
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PrintBatchStatus | '')}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả trạng thái</option>
          {BATCH_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {PRINT_BATCH_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Mã đợt</th>
              <th className="text-left px-4 py-2.5">Tên</th>
              <th className="text-left px-4 py-2.5">Campaign</th>
              <th className="text-left px-4 py-2.5">Chế độ</th>
              <th className="text-left px-4 py-2.5">Trạng thái</th>
              <th className="text-left px-4 py-2.5">Số thẻ</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {batches.map((b) => (
              <tr key={b.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/print/batches/${b.id}`)}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{b.code}</td>
                <td className="px-4 py-2.5 text-gray-700">{b.name}</td>
                <td className="px-4 py-2.5 text-gray-500">{campaignName(b.campaignId)}</td>
                <td className="px-4 py-2.5 text-gray-500">{b.mode === 'DIRECT' ? 'Trực tiếp' : 'Tập trung'}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${PRINT_BATCH_STATUS_BADGE_CLASS[b.status]}`}>
                    {PRINT_BATCH_STATUS_LABEL[b.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-500">
                  {b.printedCount}/{b.itemCount}
                  {b.failedCount > 0 && <span className="text-red-600"> ({b.failedCount} lỗi)</span>}
                </td>
                <td className="px-4 py-2.5 text-blue-600 text-xs font-medium">Xem →</td>
              </tr>
            ))}
            {batches.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  Chưa có đợt in nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CreateBatchModal
          campaigns={campaigns}
          templates={templates}
          onClose={() => setCreateOpen(false)}
          onCreated={(batch) => {
            setCreateOpen(false);
            setBatches((prev) => [batch, ...prev]);
            navigate(`/print/batches/${batch.id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateBatchModal({
  campaigns,
  templates,
  onClose,
  onCreated,
}: {
  campaigns: Campaign[];
  templates: CardTemplate[];
  onClose: () => void;
  onCreated: (batch: PrintBatch) => void;
}) {
  const [name, setName] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [defaultTemplateId, setDefaultTemplateId] = useState('');
  const [mode, setMode] = useState<'DIRECT' | 'CENTRALIZED'>('CENTRALIZED');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const batch = await createPrintBatch({
        name: name.trim(),
        campaignId: campaignId || undefined,
        defaultTemplateId: defaultTemplateId || undefined,
        mode,
      });
      onCreated(batch);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Tạo đợt in mới</h2>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tên đợt in</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Campaign (không bắt buộc)</label>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            <option value="">— Không chọn —</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Phôi in mặc định (không bắt buộc)</label>
          <select
            value={defaultTemplateId}
            onChange={(e) => setDefaultTemplateId(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            <option value="">— Không chọn —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} (v{t.version})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Chế độ in</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'DIRECT' | 'CENTRALIZED')}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            <option value="CENTRALIZED">Tập trung (xuất gói, in ở nơi khác)</option>
            <option value="DIRECT">Trực tiếp (xếp hàng cho máy in qua agent)</option>
          </select>
        </div>
        {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            onClick={submit}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang tạo...' : 'Tạo đợt in'}
          </button>
        </div>
      </div>
    </div>
  );
}

