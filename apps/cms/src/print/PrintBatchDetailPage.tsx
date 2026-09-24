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
  PrintItemStatus,
  Printer,
  PrintResultImport,
  addItemsToPrintBatch,
  bulkApplyPrintTemplate,
  bulkCreatePrintItems,
  cancelPrintBatch,
  completePrintBatch,
  downloadPrintBatchPackage,
  downloadPrintResultTemplate,
  exportPrintBatchPackage,
  getPrintBatch,
  listCampaigns,
  listCampaignSubjectDistinctValues,
  listCardTemplates,
  listPrintItemGroups,
  listPrintItems,
  listPrinters,
  listPrintResultImports,
  previewCardTemplateUrl,
  previewPrintItemUrl,
  removeItemFromPrintBatch,
  removeItemsFromPrintBatch,
  renderPrintBatch,
  renderPrintItem,
  reprintPrintItem,
  sendPrintBatch,
  updatePrintBatch,
  uploadPrintResultFile,
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
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [batch, setBatch] = useState<PrintBatch | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [statusFilter, setStatusFilter] = useState<PrintItemStatus | ''>('');
  const [classNameFilter, setClassNameFilter] = useState('');
  const [facultyFilter, setFacultyFilter] = useState('');
  const [classNameOptions, setClassNameOptions] = useState<string[]>([]);
  const [facultyOptions, setFacultyOptions] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [itemsResult, setItemsResult] = useState<Paginated<PrintItem> | null>(null);
  const [groups, setGroups] = useState<PrintItemGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTemplateOpen, setEditTemplateOpen] = useState(false);
  const [editPrinterOpen, setEditPrinterOpen] = useState(false);
  const [applyTemplateTargets, setApplyTemplateTargets] = useState<string[] | null>(null);
  const [previewItem, setPreviewItem] = useState<PrintItem | null>(null);
  const [previewingDefaultTemplate, setPreviewingDefaultTemplate] = useState(false);
  const [renderResult, setRenderResult] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resultImports, setResultImports] = useState<PrintResultImport[]>([]);
  const [uploadResultOpen, setUploadResultOpen] = useState(false);

  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => {});
    // Plan item 9: only ACTIVE templates are offered when picking a batch's
    // default template or applying a template to items.
    listCardTemplates({ status: 'ACTIVE' }).then((r) => setTemplates(r.items)).catch(() => {});
    // Unfiltered — needed to display the batch's CURRENT printer even if it
    // has since gone DISABLED/ERROR; `EditBatchPrinterModal` filters to
    // ONLINE/OFFLINE itself for the picker (plan item 9, §5 Q3).
    listPrinters().then((r) => setPrinters(r.items)).catch(() => {});
  }, []);

  function reload() {
    if (!id) return;
    setError(null);
    getPrintBatch(id)
      .then(setBatch)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
    listPrintItems({
      batchId: id,
      status: statusFilter || undefined,
      className: classNameFilter.trim() || undefined,
      faculty: facultyFilter.trim() || undefined,
      q: q.trim() || undefined,
      page,
      limit: pageSize,
    })
      .then(setItemsResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }

  useEffect(reload, [id, page, pageSize, statusFilter, classNameFilter, facultyFilter, q]);

  function reloadResultImports() {
    if (!id) return;
    listPrintResultImports(id)
      .then(setResultImports)
      .catch(() => {});
  }

  useEffect(reloadResultImports, [id]);

  useEffect(() => {
    if (batch?.campaignId) {
      listPrintItemGroups('className', batch.campaignId).then(setGroups).catch(() => {});
    }
  }, [batch?.campaignId, batch?.itemCount]);

  // Plan §G.2.e, 2026-09-17: lớp/khoa filters become dropdowns populated from
  // this batch's campaign roster (`GET /v1/campaigns/:id/subjects/distinct-values`)
  // instead of free text, same endpoint `CampaignPrintStatusPage` uses.
  useEffect(() => {
    if (!batch?.campaignId) {
      setClassNameOptions([]);
      setFacultyOptions([]);
      return;
    }
    listCampaignSubjectDistinctValues(batch.campaignId, 'className')
      .then((r) => setClassNameOptions(r.items))
      .catch(() => setClassNameOptions([]));
    listCampaignSubjectDistinctValues(batch.campaignId, 'faculty')
      .then((r) => setFacultyOptions(r.items))
      .catch(() => setFacultyOptions([]));
  }, [batch?.campaignId]);

  const items = itemsResult?.items ?? [];
  const totalItemCount = itemsResult?.meta.totalItems ?? 0;
  const campaignName = (cid?: string | null) => campaigns.find((c) => c.id === cid)?.name ?? cid ?? '—';
  const defaultTemplate = templates.find((t) => t.id === batch?.defaultTemplateId) ?? null;
  const currentPrinter = printers.find((p) => p.id === batch?.printerId) ?? null;
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
        {' · Máy in: '}
        {currentPrinter ? currentPrinter.name : '— chưa chọn —'}
        {canEdit && (
          <button type="button" onClick={() => setEditPrinterOpen(true)} className="ml-2 text-blue-600 hover:text-blue-800 underline">
            Đổi máy in
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
        {canEdit && batch.mode === 'DIRECT' && (
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
            Gửi in
            {selected.size > 0 ? ` (${selected.size} mục đã chọn)` : ''}
          </button>
        )}
        {canEdit && batch.mode === 'CENTRALIZED' && (
          <button
            type="button"
            disabled={busy || totalItemCount === 0}
            onClick={() =>
              void withBusy(async () => {
                const { blob, filename } = await exportPrintBatchPackage(batch.id, selectedIds);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                reload();
              })
            }
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            Xuất gói
            {selected.size > 0 ? ` (${selected.size} mục đã chọn)` : ''}
          </button>
        )}
        {canEdit && batch.mode === 'CENTRALIZED' && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void withBusy(async () => {
                setBatch(await completePrintBatch(batch.id));
                reload();
              })
            }
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            Hoàn tất đợt
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

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo mã SV hoặc tên..."
          className="flex-1 min-w-[180px] bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
        />
        <select
          value={classNameFilter}
          onChange={(e) => {
            setClassNameFilter(e.target.value);
            setPage(1);
          }}
          className="w-32 bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
        >
          <option value="">Tất cả lớp</option>
          {classNameOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={facultyFilter}
          onChange={(e) => {
            setFacultyFilter(e.target.value);
            setPage(1);
          }}
          className="w-32 bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
        >
          <option value="">Tất cả khoa</option>
          {facultyOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as PrintItemStatus | '');
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
        >
          <option value="">Tất cả trạng thái</option>
          {(Object.keys(PRINT_ITEM_STATUS_LABEL) as PrintItemStatus[]).map((s) => (
            <option key={s} value={s}>
              {PRINT_ITEM_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
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

      <div className="mt-6 p-4 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Kết quả in ấn</h3>
          <button
            type="button"
            onClick={() => setUploadResultOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
          >
            Tải lên kết quả in
          </button>
        </div>

        {resultImports.length === 0 && <p className="text-sm text-gray-500">Chưa có lần upload kết quả in nào.</p>}

        {resultImports.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-gray-500 uppercase">
              <tr>
                <th className="text-left py-1.5">File</th>
                <th className="text-left py-1.5">Trạng thái</th>
                <th className="text-left py-1.5">Khớp / Đã in / Lỗi / Không khớp / Tổng</th>
                <th className="text-left py-1.5">Lúc</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {resultImports.map((imp) => (
                <tr key={imp.id}>
                  <td className="py-1.5 text-gray-900">{imp.fileName}</td>
                  <td className="py-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded-full border ${
                        imp.status === 'DONE'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : imp.status === 'FAILED'
                            ? 'bg-red-50 border-red-200 text-red-700'
                            : 'bg-gray-50 border-gray-200 text-gray-600'
                      }`}
                    >
                      {imp.status === 'DONE' ? 'Hoàn tất' : imp.status === 'FAILED' ? 'Lỗi' : 'Đang xử lý'}
                    </span>
                    {imp.failureReason && <span className="ml-1.5 text-red-600">{imp.failureReason}</span>}
                  </td>
                  <td className="py-1.5 text-gray-500 tabular-nums">
                    {imp.matchedRows} / {imp.printedRows} / {imp.failedRows} / {imp.unmatchedRows} / {imp.totalRows}
                  </td>
                  <td className="py-1.5 text-gray-500">{formatDateTime(imp.createdAt)}</td>
                  <td className="py-1.5 text-right">
                    {imp.errorReportUrl && (
                      <a href={imp.errorReportUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                        Xem lỗi
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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

      {editPrinterOpen && (
        <EditBatchPrinterModal
          batch={batch}
          printers={printers}
          onClose={() => setEditPrinterOpen(false)}
          onSaved={(updated) => {
            setEditPrinterOpen(false);
            setBatch(updated);
          }}
        />
      )}

      {uploadResultOpen && (
        <UploadPrintResultModal
          batchId={batch.id}
          onClose={() => setUploadResultOpen(false)}
          onUploaded={() => {
            setUploadResultOpen(false);
            reloadResultImports();
            reload();
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
 * "Đổi máy in" — plan item 9: `PATCH /v1/print/batches/:id {printerId}`
 * already accepted this field (`UpdatePrintBatchInput.printerId`), there was
 * just no UI for it at all, same gap `EditBatchTemplateModal` above used to
 * have for the template field. Only ONLINE/OFFLINE printers are offered
 * (§5 Q3, chốt 2026-09-17) — ERROR/DISABLED excluded even if that happens to
 * be the batch's current printer (it still shows in the header text via
 * `currentPrinter`, just not selectable again here).
 */
function EditBatchPrinterModal({
  batch,
  printers,
  onClose,
  onSaved,
}: {
  batch: PrintBatch;
  printers: Printer[];
  onClose: () => void;
  onSaved: (batch: PrintBatch) => void;
}) {
  const [printerId, setPrinterId] = useState(batch.printerId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectable = printers.filter((p) => p.status === 'ONLINE' || p.status === 'OFFLINE');

  async function submit() {
    if (!printerId) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await updatePrintBatch(batch.id, { printerId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Đổi máy in của đợt in" onClose={onClose}>
      <div className="space-y-3">
        <select
          value={printerId}
          onChange={(e) => setPrinterId(e.target.value)}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        >
          <option value="">— Chọn máy in —</option>
          {selectable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.status === 'ONLINE' ? 'Trực tuyến' : 'Ngoại tuyến'})
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
            disabled={busy || !printerId}
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

/**
 * "Tải lên kết quả in" (Giai đoạn 4, plan §4.3) — the backend
 * (`PrintResultImportController`) existed with no CMS UI at all until
 * 2026-09-22. Same "button opens a dialog, dialog has a separate upload
 * button" shape `CampaignRosterPanel`'s roster-import dialog already
 * uses (2026-09-22 product ask, applied here too for consistency) rather
 * than an always-visible inline file input.
 */
function UploadPrintResultModal({
  batchId,
  onClose,
  onUploaded,
}: {
  batchId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function downloadTemplate() {
    try {
      const { blob, filename } = await downloadPrintResultTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      await uploadPrintResultFile(batchId, selectedFile);
      onUploaded();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <ModalShell title="Tải lên kết quả in" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Chọn file Excel (.xlsx) kết quả in theo đúng mẫu.</span>
          <button type="button" onClick={() => void downloadTemplate()} className="text-xs text-blue-600 hover:text-blue-800 underline shrink-0">
            Tải file mẫu
          </button>
        </div>
        <input
          type="file"
          accept=".xlsx"
          disabled={uploading}
          onChange={(e) => {
            setSelectedFile(e.target.files?.[0] ?? null);
            setUploadError(null);
          }}
          className="w-full text-sm text-gray-700"
        />
        {uploadError && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{uploadError}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={uploading} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={!selectedFile || uploading}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {uploading ? 'Đang tải lên...' : 'Tải lên'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
