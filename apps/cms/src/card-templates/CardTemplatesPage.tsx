import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  CardTemplate,
  CardTemplateStatus,
  Paginated,
  createCardTemplate,
  listCardTemplates,
} from '../api';
import { ModalShell } from '../components/CampaignDangerActions';
import { DEFAULT_PAGE_SIZE, Pager } from '../components/Pager';

export const CARD_TEMPLATE_STATUS_LABEL: Record<CardTemplateStatus, string> = {
  DRAFT: 'Nháp',
  ACTIVE: 'Đang dùng',
  ARCHIVED: 'Lưu trữ',
};

export const CARD_TEMPLATE_STATUS_BADGE_CLASS: Record<CardTemplateStatus, string> = {
  DRAFT: 'bg-gray-50 border-gray-200 text-gray-600',
  ACTIVE: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  ARCHIVED: 'bg-amber-50 border-amber-200 text-amber-700',
};

const STATUS_OPTIONS: CardTemplateStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

/**
 * "Phôi thẻ" (Task C, 2026-09-16) — card-template CRUD + layout editor.
 * `PrintPage.tsx` previously only listed templates (to populate a batch's
 * template picker) and previewed them — this is the actual authoring UI the
 * old `PrintPage.tsx` doc comment flagged as "out of scope (no mockup for
 * it)". List page here (`Pager`-paginated, same wiring `AnglePresetsPage.tsx`
 * uses); the create form, layout editor, asset management, and lifecycle
 * actions (publish/archive/duplicate/delete) all live on
 * `CardTemplateDetailPage.tsx` at `/card-templates/:id`.
 */
export function CardTemplatesPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CardTemplateStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState<Paginated<CardTemplate> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  function reload() {
    setError(null);
    listCardTemplates({ status: status || undefined, q: q.trim() || undefined, page, limit: pageSize })
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }

  useEffect(reload, [q, status, page, pageSize]);

  const templates = result?.items ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Phôi thẻ</h1>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
        >
          + Tạo phôi
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
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as CardTemplateStatus | '');
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả trạng thái</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {CARD_TEMPLATE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Mã</th>
              <th className="text-left px-4 py-2.5">Tên</th>
              <th className="text-left px-4 py-2.5">Trạng thái</th>
              <th className="text-left px-4 py-2.5">Phiên bản</th>
              <th className="text-left px-4 py-2.5">Đã dùng</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {templates.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/card-templates/${t.id}`)}>
                <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{t.code}</td>
                <td className="px-4 py-2.5 text-gray-900 font-medium">{t.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${CARD_TEMPLATE_STATUS_BADGE_CLASS[t.status]}`}>
                    {CARD_TEMPLATE_STATUS_LABEL[t.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-500">v{t.version}</td>
                <td className="px-4 py-2.5 text-gray-500 tabular-nums">{t.usageCount}</td>
                <td className="px-4 py-2.5 text-blue-600 text-xs font-medium">Xem →</td>
              </tr>
            ))}
            {templates.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Chưa có phôi thẻ nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        meta={result?.meta}
        itemLabel="phôi thẻ"
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {createOpen && (
        <CreateTemplateModal
          onClose={() => setCreateOpen(false)}
          onCreated={(template) => navigate(`/card-templates/${template.id}`)}
        />
      )}
    </div>
  );
}

function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (template: CardTemplate) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [widthMm, setWidthMm] = useState(85.6);
  const [heightMm, setHeightMm] = useState(54);
  const [dpi, setDpi] = useState<300 | 600>(300);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const template = await createCardTemplate({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        cardSize: { widthMm, heightMm },
        dpi,
      });
      onCreated(template);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Tạo phôi thẻ mới" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Mã phôi (duy nhất)</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tên phôi</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Mô tả (không bắt buộc)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Rộng (mm)</label>
            <input
              type="number"
              step="0.1"
              value={widthMm}
              onChange={(e) => setWidthMm(Number(e.target.value))}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cao (mm)</label>
            <input
              type="number"
              step="0.1"
              value={heightMm}
              onChange={(e) => setHeightMm(Number(e.target.value))}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">DPI</label>
            <select
              value={dpi}
              onChange={(e) => setDpi(Number(e.target.value) as 300 | 600)}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            >
              <option value={300}>300</option>
              <option value={600}>600</option>
            </select>
          </div>
        </div>
        {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            type="submit"
            disabled={saving || !code.trim() || !name.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang tạo...' : 'Tạo phôi'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
