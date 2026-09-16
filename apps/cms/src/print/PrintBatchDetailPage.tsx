import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  Campaign,
  CardTemplate,
  Paginated,
  PrintBatch,
  PrintItem,
  PrintItemGroup,
  addItemsToPrintBatch,
  bulkApplyPrintTemplate,
  bulkCreatePrintItems,
  cancelPrintBatch,
  downloadPrintBatchPackage,
  getPrintBatch,
  listCampaigns,
  listCardTemplates,
  listPrintItemGroups,
  listPrintItems,
  previewCardTemplateUrl,
  previewPrintItemUrl,
  removeItemFromPrintBatch,
  removeItemsFromPrintBatch,
  renderPrintBatch,
  renderPrintItem,
  reprintPrintItem,
  sendPrintBatch,
  updatePrintBatch,
} from '../api';
import { CardPreviewModal } from './CardPreviewModal';
import { ModalShell } from '../components/CampaignDangerActions';
import { DEFAULT_PAGE_SIZE, Pager } from '../components/Pager';
import {
  PRINT_BATCH_STATUS_BADGE_CLASS,
  PRINT_BATCH_STATUS_LABEL,
  PRINT_ITEM_STATUS_BADGE_CLASS,
  PRINT_ITEM_STATUS_LABEL,
  formatDateTime,
} from './printFormat';

/**
 * `/print/batches/:id` — routed batch-detail page (2026-09-16). Moved out of
 * `PrintPage.tsx`'s `PrintBatchDetailModal` (a local `selectedBatchId` state
 * + fixed-overlay modal, no URL) into a real route, same `useParams`/
 * `reload()`/`useNavigate()` shape `CampaignDetail.tsx` uses — a batch's
 * detail view is now bookmarkable/shareable and has working back/forward,
 * same reasoning `App.tsx`'s own doc comment gives for the router itself.
 *
 * Self-contained: fetches its own `campaigns`/`templates` rather than
 * receiving them as props from `PrintPage`, since this page can now be
 * opened directly (a link, a refresh, forward/back) without `PrintPage`
 * ever having mounted first.
 *
 * Adds checkbox multi-select (same `Set<string>` convention
 * `AddApprovedStudentsModal` below already uses) so "Hoàn tất, xuất gói" /
 * "Tải gói (zip)" / "Gỡ" can act on a chosen subset instead of always the
 * whole batch — purely additive: selecting nothing keeps every action's old
 * whole-batch behavior.
 */
export function PrintBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [batch, setBatch] = useState<PrintBatch | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [itemsResult, setItemsResult] = useState<Paginated<PrintItem> | null>(null);
  const [groups, setGroups] = useState<PrintItemGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTemplateOpen, setEditTemplateOpen] = useState(false);
  const [applyTemplateTargets, setApplyTemplateTargets] = useState<string[] | null>(null);
  const [previewItem, setPreviewItem] = useState<PrintItem | null>(null);
  const [previewingDefaultTemplate, setPreviewingDefaultTemplate] = useState(false);
  const [renderResult, setRenderResult] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => {});
    listCardTemplates().then((r) => setTemplates(r.items)).catch(() => {});
  }, []);

  function reload() {
    if (!id) return;
    setError(null);
    getPrintBatch(id)
      .then(setBatch)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
    listPrintItems({ batchId: id, page, limit: pageSize })
      .then(setItemsResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }

  useEffect(reload, [id, page, pageSize]);

  useEffect(() => {
    if (batch?.campaignId) {
      listPrintItemGroups('className', batch.campaignId).then(setGroups).catch(() => {});
    }
  }, [batch?.campaignId, batch?.itemCount]);

  const items = itemsResult?.items ?? [];
  const totalItemCount = itemsResult?.meta.totalItems ?? 0;
  const campaignName = (cid?: string | null) => campaigns.find((c) => c.id === cid)?.name ?? cid ?? '—';
  const defaultTemplate = templates.find((t) => t.id === batch?.defaultTemplateId) ?? null;
  const selectedIds = Array.from(selected);

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    const pageIds = items.map((i) => i.id);
    const allSelected = pageIds.length > 0 && pageIds.every((pid) => selected.has(pid));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((pid) => next.delete(pid));
      else pageIds.forEach((pid) => next.add(pid));
      return next;
    });
  }

  if (!id) return null;
  if (error && !batch) return <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>;
  if (!batch) return <p className="text-gray-500">Đang tải...</p>;

  const canEdit = batch.status === 'DRAFT' || batch.status === 'READY';
  const pageIds = items.map((i) => i.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((pid) => selected.has(pid));

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/print')}
        className="text-gray-500 hover:text-gray-700 mb-4 inline-block text-sm"
      >
        ← Danh sách đợt in
      </button>

      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h1 className="text-xl font-bold text-gray-900">{batch.name}</h1>
        <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${PRINT_BATCH_STATUS_BADGE_CLASS[batch.status]}`}>
          {PRINT_BATCH_STATUS_LABEL[batch.status]}
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-1">
        {batch.code} · {campaignName(batch.campaignId)} · {batch.mode === 'DIRECT' ? 'In trực tiếp' : 'Xuất gói tập trung'}
      </p>
      <p className="text-xs text-gray-400 mb-4">
        Tạo lúc {formatDateTime(batch.createdAt)}
        {batch.sentAt ? ` · Gửi lúc ${formatDateTime(batch.sentAt)}` : ''}
        {batch.doneAt ? ` · Hoàn tất lúc ${formatDateTime(batch.doneAt)}` : ''}
        {' · Phôi mặc định: '}
        {defaultTemplate ? (
          <button type="button" onClick={() => setPreviewingDefaultTemplate(true)} className="text-blue-600 hover:text-blue-800 underline">
            {defaultTemplate.name}
          </button>
        ) : (
          '— chưa chọn —'
        )}
        {canEdit && (
          <button type="button" onClick={() => setEditTemplateOpen(true)} className="ml-2 text-blue-600 hover:text-blue-800 underline">
            Đổi phôi mặc định
          </button>
        )}
      </p>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-4">{error}</div>}
      {renderResult && <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm mb-4">{renderResult}</div>}

      {groups.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {groups.map((g) => (
            <span key={g.value ?? '—'} className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600">
              {g.value ?? 'Chưa có lớp'}: {g.total} ({g.printed} đã in{g.failed > 0 ? `, ${g.failed} lỗi` : ''})
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {canEdit && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium"
          >
            + Thêm SV đã duyệt
          </button>
        )}
        <button
          type="button"
          disabled={busy || totalItemCount === 0}
          onClick={() =>
            void withBusy(async () => {
              const result = await renderPrintBatch(batch.id);
              setRenderResult(`Đã render ${result.rendered} thẻ${result.failed > 0 ? `, ${result.failed} lỗi` : ''}.`);
              reload();
            })
          }
          className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
        >
          Render cả đợt
        </button>
        {canEdit && (
          <button
            type="button"
            disabled={busy || totalItemCount === 0}
            onClick={() =>
              void withBusy(async () => {
                setBatch(await sendPrintBatch(batch.id, selectedIds));
                reload();
              })
            }
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {batch.mode === 'DIRECT' ? 'Gửi in' : 'Hoàn tất, xuất gói'}
            {selected.size > 0 ? ` (${selected.size} mục đã chọn)` : ''}
          </button>
        )}
        {batch.mode === 'CENTRALIZED' && batch.status !== 'DRAFT' && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void withBusy(async () => {
                const { blob, filename } = await downloadPrintBatchPackage(batch.id, selectedIds);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
              })
            }
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
          >
            Tải gói (zip){selected.size > 0 ? ` (${selected.size} mục đã chọn)` : ''}
          </button>
        )}
        {selected.size > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setApplyTemplateTargets(selectedIds)}
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
          >
            Áp dụng phôi ({selected.size})
          </button>
        )}
        {canEdit && selected.size > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void withBusy(async () => {
                await removeItemsFromPrintBatch(batch.id, selectedIds);
                setSelected(new Set());
                reload();
              })
            }
            className="px-3 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm font-medium disabled:opacity-50"
          >
            Gỡ các mục đã chọn ({selected.size})
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void withBusy(async () => {
                setBatch(await cancelPrintBatch(batch.id));
              })
            }
            className="ml-auto px-3 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm font-medium disabled:opacity-50"
          >
            Hủy đợt
          </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAllOnPage}
                  disabled={items.length === 0}
                  className="rounded border-gray-300"
                  aria-label="Chọn tất cả trang này"
                />
              </th>
              <th className="text-left px-3 py-2">Mã SV</th>
              <th className="text-left px-3 py-2">Họ tên</th>
              <th className="text-left px-3 py-2">Lớp</th>
              <th className="text-left px-3 py-2">Trạng thái</th>
              <th className="text-left px-3 py-2">Thiếu dữ liệu</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item) => (
              <tr key={item.id} className={`hover:bg-gray-50 ${selected.has(item.id) ? 'bg-blue-50/40' : ''}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="px-3 py-2 font-medium text-gray-900">{item.subjectCode}</td>
                <td className="px-3 py-2 text-gray-700">{item.fullName ?? '—'}</td>
                <td className="px-3 py-2 text-gray-500">{item.className ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${PRINT_ITEM_STATUS_BADGE_CLASS[item.status]}`}>
                    {PRINT_ITEM_STATUS_LABEL[item.status]}
                  </span>
                </td>
                <td className="px-3 py-2 text-amber-600 text-xs">{item.missingFields.length > 0 ? item.missingFields.join(', ') : '—'}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button type="button" onClick={() => setPreviewItem(item)} className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3">
                    Xem trước
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setApplyTemplateTargets([item.id])}
                    className="text-gray-600 hover:text-gray-800 text-xs font-medium mr-3 disabled:opacity-40"
                  >
                    Áp dụng phôi
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void withBusy(async () => { await renderItemOne(item.id); reload(); })}
                      className="text-gray-600 hover:text-gray-800 text-xs font-medium mr-3 disabled:opacity-40"
                    >
                      Render
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void withBusy(async () => { await removeItemFromPrintBatch(batch.id, item.id); reload(); })}
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
                      Gỡ
                    </button>
                  )}
                  {(item.status === 'PRINTED' || item.status === 'FAILED') && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void withBusy(async () => { await reprintPrintItem(item.id); reload(); })}
                      className="text-gray-600 hover:text-gray-800 text-xs font-medium ml-3"
                    >
                      In lại
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                  Chưa có sinh viên nào trong đợt in này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        meta={itemsResult?.meta}
        itemLabel="sinh viên"
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {addOpen && batch.campaignId && (
        <AddApprovedStudentsModal
          batchId={batch.id}
          campaignId={batch.campaignId}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            reload();
          }}
        />
      )}

      {editTemplateOpen && (
        <EditBatchTemplateModal
          batch={batch}
          templates={templates}
          onClose={() => setEditTemplateOpen(false)}
          onSaved={(updated) => {
            setEditTemplateOpen(false);
            setBatch(updated);
          }}
        />
      )}

      {applyTemplateTargets && (
        <ApplyTemplateModal
          templates={templates}
          itemIds={applyTemplateTargets}
          onClose={() => setApplyTemplateTargets(null)}
          onDone={() => {
            setApplyTemplateTargets(null);
            reload();
          }}
        />
      )}

      {previewItem && (
        <CardPreviewModal
          title={`Xem trước — ${previewItem.subjectCode}`}
          fetchUrl={(side) => previewPrintItemUrl(previewItem.id, side)}
          onClose={() => setPreviewItem(null)}
        />
      )}

      {previewingDefaultTemplate && defaultTemplate && (
        <CardPreviewModal
          title={`Xem trước phôi — ${defaultTemplate.name} (dữ liệu mẫu)`}
          fetchUrl={(side) => previewCardTemplateUrl(defaultTemplate.id, { sampleData: {}, side })}
          onClose={() => setPreviewingDefaultTemplate(false)}
        />
      )}
    </div>
  );

  async function renderItemOne(itemId: string) {
    await renderPrintItem(itemId);
  }
}

/**
 * "Đổi phôi mặc định" — `PATCH /v1/print/batches/:id {defaultTemplateId}`
 * already existed server-side (Task A's brief calls out it "just has no
 * UI"); this is that missing UI, same `<select>` `CreateBatchModal` (in
 * `PrintPage.tsx`) already uses for the same field at batch-CREATE time.
 */
function EditBatchTemplateModal({
  batch,
  templates,
  onClose,
  onSaved,
}: {
  batch: PrintBatch;
  templates: CardTemplate[];
  onClose: () => void;
  onSaved: (batch: PrintBatch) => void;
}) {
  const [defaultTemplateId, setDefaultTemplateId] = useState(batch.defaultTemplateId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!defaultTemplateId) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await updatePrintBatch(batch.id, { defaultTemplateId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Đổi phôi mặc định của đợt in" onClose={onClose}>
      <div className="space-y-3">
        <select
          value={defaultTemplateId}
          onChange={(e) => setDefaultTemplateId(e.target.value)}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        >
          <option value="">— Chọn phôi —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} (v{t.version})
            </option>
          ))}
        </select>
        {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Đóng
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !defaultTemplateId}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * "Áp dụng phôi" for either the checkbox multi-selection or a single row's
 * own action — `bulkApplyPrintTemplate` (already in `api.ts`, previously
 * unused from any CMS screen) only sets `templateId` on each item, it does
 * not render — same two-step "pick, then render" flow the item table's own
 * "Render" button already exposes separately.
 */
function ApplyTemplateModal({
  templates,
  itemIds,
  onClose,
  onDone,
}: {
  templates: CardTemplate[];
  itemIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!templateId) return;
    setBusy(true);
    setError(null);
    try {
      await bulkApplyPrintTemplate({ itemIds, templateId });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`Áp dụng phôi cho ${itemIds.length} thẻ`} onClose={onClose}>
      <div className="space-y-3">
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        >
          <option value="">— Chọn phôi —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} (v{t.version})
            </option>
          ))}
        </select>
        {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Đóng
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !templateId}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {busy ? 'Đang áp dụng...' : 'Áp dụng'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * "Thêm SV đã duyệt" — the two-step flow `bulkCreatePrintItems`'s own doc
 * comment describes: create unattached items for the campaign (optionally
 * narrowed by lớp/khoa), then re-list them (unattached rows have
 * `batchId: null`) so the operator can pick which ones to attach — the
 * create response only carries a count, not the new ids. Moved here
 * unchanged from `PrintPage.tsx`'s old `PrintBatchDetailModal` — it's only
 * ever used from this batch-detail view.
 */
function AddApprovedStudentsModal({
  batchId,
  campaignId,
  onClose,
  onDone,
}: {
  batchId: string;
  campaignId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [className, setClassName] = useState('');
  const [faculty, setFaculty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unattached, setUnattached] = useState<PrintItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // No server-side "chưa gán đợt" filter exists on `GET /v1/print/items` (only
  // `batchId` for a SPECIFIC batch) — client-side filtering happens after the
  // fact, same as before. What changed: a single `limit: 200` call used to
  // exceed the endpoint's `@Max(100)` validation once a campaign had more
  // than 100 print items at all (attached + unattached combined), throwing
  // "limit must not be greater than 100". Paging through in chunks of 100
  // keeps every request valid while still gathering every unattached item
  // for this picker (which genuinely needs the full set, not one page of it).
  async function fetchAllUnattached(): Promise<PrintItem[]> {
    const all: PrintItem[] = [];
    let page = 1;
    for (;;) {
      const r = await listPrintItems({ campaignId, page, limit: 100 });
      all.push(...r.items.filter((i) => !i.batchId));
      if (!r.meta.totalPages || page >= r.meta.totalPages) break;
      page++;
    }
    return all;
  }

  function reloadUnattached() {
    fetchAllUnattached()
      .then(setUnattached)
      .catch(() => {});
  }

  useEffect(reloadUnattached, [campaignId]);

  async function createFromApproved() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await bulkCreatePrintItems({
        filter: { campaignId, className: className.trim() || undefined, faculty: faculty.trim() || undefined },
      });
      setMessage(`Đã tạo ${result.created} thẻ mới${result.skipped.length > 0 ? `, bỏ qua ${result.skipped.length} hồ sơ (đã có item)` : ''}.`);
      reloadUnattached();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function attachSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await addItemsToPrintBatch(batchId, Array.from(selected));
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Thêm sinh viên đã duyệt vào đợt in</h2>

        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
          <p className="text-xs text-gray-500">
            Bước 1: tạo thẻ (item in) cho hồ sơ đã <span className="font-medium">Duyệt</span> trong campaign này — có thể lọc theo lớp/khoa.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder="Lớp (để trống = tất cả)"
              className="flex-1 min-w-[140px] bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
            />
            <input
              value={faculty}
              onChange={(e) => setFaculty(e.target.value)}
              placeholder="Khoa (để trống = tất cả)"
              className="flex-1 min-w-[140px] bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void createFromApproved()}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
            >
              Tạo thẻ
            </button>
          </div>
          {message && <p className="text-xs text-emerald-700">{message}</p>}
        </div>

        <div>
          <p className="text-xs text-gray-500 mb-1.5">Bước 2: chọn thẻ chưa thuộc đợt nào để thêm vào đợt in này.</p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
            {unattached.map((item) => (
              <label key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="rounded border-gray-300" />
                <span className="font-medium text-gray-900">{item.subjectCode}</span>
                <span className="text-gray-500">{item.fullName ?? '—'}</span>
                <span className="text-gray-400 ml-auto">{item.className ?? '—'}</span>
              </label>
            ))}
            {unattached.length === 0 && <p className="px-3 py-6 text-center text-gray-400 text-sm">Chưa có thẻ nào chưa thuộc đợt in.</p>}
          </div>
        </div>

        {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Đóng
          </button>
          <button
            onClick={() => void attachSelected()}
            disabled={busy || selected.size === 0}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            Thêm {selected.size > 0 ? `(${selected.size})` : ''} vào đợt
          </button>
        </div>
      </div>
    </div>
  );
}
