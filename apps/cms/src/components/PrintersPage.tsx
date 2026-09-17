import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  Campaign,
  CardTemplate,
  CreatePrinterInput,
  Paginated,
  Printer,
  PrinterConnectionType,
  PrinterDetail,
  PrinterPrintMode,
  PrinterStatus,
  PrinterStockAdjustReason,
  PrinterStockEvent,
  PrinterUsageMode,
  adjustPrinterStock,
  createPrinter,
  disablePrinter,
  enablePrinter,
  getPrinter,
  issuePrinterToken,
  listCampaigns,
  listCardTemplates,
  listPrinterStockEvents,
  listPrinters,
  testPrintPrinter,
  updatePrinter,
} from '../api';
import { formatDateTime } from '../print/printFormat';
import { ModalShell } from './CampaignDangerActions';
import { DEFAULT_PAGE_SIZE, Pager } from './Pager';

const PRINT_MODE_LABEL: Record<PrinterPrintMode, string> = { SINGLE_SIDE: '1 mặt', DUPLEX: '2 mặt' };
const USAGE_MODE_LABEL: Record<PrinterUsageMode, string> = { DIRECT: 'Trực tiếp (tại kiosk)', CENTRALIZED: 'Tập trung' };
const STATUS_LABEL: Record<PrinterStatus, string> = {
  ONLINE: 'Đang hoạt động',
  OFFLINE: 'Ngoại tuyến',
  ERROR: 'Lỗi',
  DISABLED: 'Đã vô hiệu hóa',
};
const STATUS_BADGE_CLASS: Record<PrinterStatus, string> = {
  ONLINE: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  OFFLINE: 'bg-gray-50 border-gray-200 text-gray-600',
  ERROR: 'bg-red-50 border-red-200 text-red-700',
  DISABLED: 'bg-amber-50 border-amber-200 text-amber-700',
};
const CONNECTION_TYPE_LABEL: Record<PrinterConnectionType, string> = {
  USB: 'USB',
  NETWORK: 'Mạng (IP)',
  AGENT: 'Print agent',
};
const STOCK_REASON_LABEL: Record<string, string> = {
  REFILL: 'Nạp phôi mới',
  PRINT: 'In thẻ (tự động)',
  ADJUST: 'Điều chỉnh (kiểm kê)',
  WASTE: 'Hao hụt/hỏng',
};

/**
 * "Quản lý máy in" — a printer's own hardware/lifecycle record (this page),
 * distinct from `print/PrintPage.tsx`'s "In thẻ" (print BATCHES/ITEMS — the
 * jobs a printer executes) and from `CampaignAssignmentsPanel.tsx` (staff↔
 * kiosk device assignment, unrelated hardware). Backend is
 * `apps/api/src/modules/print/controllers/printer.controller.ts` — fully
 * built already, this is CMS-only wiring.
 *
 * List + detail-page pattern (not a modal for edit) since a printer's
 * detail view needs room for stock history + token issuance + enable/
 * disable + test-print — "form takes over the page" rather than cramming
 * all of that into `ModalShell`'s `max-w-md`.
 */
export function PrintersPage() {
  const [statusFilter, setStatusFilter] = useState<PrinterStatus | ''>('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState<Paginated<Printer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  const reload = () => {
    listPrinters({
      status: statusFilter || undefined,
      campaignId: campaignFilter || undefined,
      q: q.trim() || undefined,
      page,
      limit: pageSize,
    })
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, [statusFilter, campaignFilter, q, page, pageSize]);

  const printers = result?.items ?? null;

  if (detailId) {
    return (
      <PrinterDetailPage
        printerId={detailId}
        onBack={() => {
          setDetailId(null);
          reload();
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Máy in</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Danh mục máy in vật lý (phần cứng) — khác với "In thẻ" (đợt in/thẻ đang chờ in).
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shrink-0"
        >
          + Thêm máy in
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo tên/model..."
          className="flex-1 min-w-[200px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        />
        <select
          value={campaignFilter}
          onChange={(e) => {
            setCampaignFilter(e.target.value);
            setPage(1);
          }}
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
          onChange={(e) => {
            setStatusFilter(e.target.value as PrinterStatus | '');
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả trạng thái</option>
          {(Object.keys(STATUS_LABEL) as PrinterStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {printers === null && !error && <p className="text-gray-500">Đang tải...</p>}
      {printers && printers.length === 0 && <p className="text-gray-500">Chưa có máy in nào khớp bộ lọc.</p>}

      {printers && printers.length > 0 && (
        <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-4">Tên</th>
              <th className="py-2.5 px-4">Chế độ</th>
              <th className="py-2.5 px-4">Vị trí</th>
              <th className="py-2.5 px-4">Trạng thái</th>
              <th className="py-2.5 px-4">Phôi còn lại</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {printers.map((p) => (
              <tr
                key={p.id}
                className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
                onClick={() => setDetailId(p.id)}
              >
                <td className="py-2.5 px-4 text-gray-900 font-medium">
                  {p.name}
                  {p.model && <span className="text-gray-400 font-normal"> · {p.model}</span>}
                </td>
                <td className="py-2.5 px-4 text-gray-500">
                  {USAGE_MODE_LABEL[p.usageMode]} · {PRINT_MODE_LABEL[p.printMode]}
                </td>
                <td className="py-2.5 px-4 text-gray-500">{p.location || '—'}</td>
                <td className="py-2.5 px-4">
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_BADGE_CLASS[p.status]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td className="py-2.5 px-4 tabular-nums">
                  <span className={p.lowStock ? 'text-red-600 font-semibold' : 'text-gray-700'}>{p.blankStock}</span>
                  {p.lowStock && (
                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 align-middle">
                      sắp hết
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right text-blue-600 text-xs font-medium">Chi tiết →</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pager
        meta={result?.meta}
        itemLabel="máy in"
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {createOpen && (
        <CreatePrinterModal
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            reload();
            setDetailId(created.id);
          }}
        />
      )}
    </div>
  );
}

/** Controlled local form state shared between the create modal and the detail page's edit section — avoids duplicating ~10 fields' worth of JSX twice, same reasoning `CardSpecFields.tsx` gives for its own extraction. */
interface PrinterFormValues {
  name: string;
  model: string;
  printMode: PrinterPrintMode;
  usageMode: PrinterUsageMode;
  location: string;
  deviceId: string;
  hasConnection: boolean;
  connectionType: PrinterConnectionType;
  connectionAddress: string;
  connectionSpoolerName: string;
  lowStockThreshold: number;
  defaultTemplateId: string;
}

function initPrinterFormValues(p?: Printer): PrinterFormValues {
  return {
    name: p?.name ?? '',
    model: p?.model ?? '',
    printMode: p?.printMode ?? 'SINGLE_SIDE',
    usageMode: p?.usageMode ?? 'CENTRALIZED',
    location: p?.location ?? '',
    deviceId: p?.deviceId ?? '',
    hasConnection: p?.connection != null,
    connectionType: p?.connection?.type ?? 'NETWORK',
    connectionAddress: p?.connection?.address ?? '',
    connectionSpoolerName: p?.connection?.spoolerName ?? '',
    lowStockThreshold: p?.lowStockThreshold ?? 0,
    defaultTemplateId: p?.defaultTemplateId ?? '',
  };
}

/** Builds everything `CreatePrinterInput`/`UpdatePrinterInput` share (i.e. all of it except `blankStock`, which only the create form asks for separately — see `UpdatePrinterInput`'s own doc comment in api.ts for why). */
function buildPrinterInput(values: PrinterFormValues): Omit<CreatePrinterInput, 'blankStock'> {
  return {
    name: values.name.trim(),
    model: values.model.trim() || undefined,
    printMode: values.printMode,
    usageMode: values.usageMode,
    location: values.location.trim() || undefined,
    deviceId: values.deviceId.trim() || undefined,
    connection: values.hasConnection
      ? {
          type: values.connectionType,
          address: values.connectionAddress.trim() || undefined,
          spoolerName: values.connectionSpoolerName.trim() || undefined,
        }
      : undefined,
    lowStockThreshold: values.lowStockThreshold,
    defaultTemplateId: values.defaultTemplateId || undefined,
  };
}

function PrinterFormFields({
  values,
  onChange,
  templates,
}: {
  values: PrinterFormValues;
  onChange: (patch: Partial<PrinterFormValues>) => void;
  templates: CardTemplate[];
}) {
  return (
    <>
      <div>
        <label className="block text-sm text-gray-500 mb-1">Tên máy in</label>
        <input
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          required
          placeholder="Máy in phòng A1"
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-500 mb-1">Model</label>
        <input
          value={values.model}
          onChange={(e) => onChange({ model: e.target.value })}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Chế độ in</label>
          <select
            value={values.printMode}
            onChange={(e) => onChange({ printMode: e.target.value as PrinterPrintMode })}
            className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
          >
            {(Object.keys(PRINT_MODE_LABEL) as PrinterPrintMode[]).map((m) => (
              <option key={m} value={m}>
                {PRINT_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Chế độ dùng</label>
          <select
            value={values.usageMode}
            onChange={(e) => onChange({ usageMode: e.target.value as PrinterUsageMode })}
            className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
          >
            {(Object.keys(USAGE_MODE_LABEL) as PrinterUsageMode[]).map((m) => (
              <option key={m} value={m}>
                {USAGE_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm text-gray-500 mb-1">Vị trí</label>
        <input
          value={values.location}
          onChange={(e) => onChange({ location: e.target.value })}
          placeholder="Phòng A1 - tầng 2"
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-500 mb-1">
          Kiosk gắn máy in (để trống nếu đặt tại phòng in tập trung)
        </label>
        <input
          value={values.deviceId}
          onChange={(e) => onChange({ deviceId: e.target.value })}
          placeholder="UUID thiết bị"
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 font-mono text-xs"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={values.hasConnection}
          onChange={(e) => onChange({ hasConnection: e.target.checked })}
          className="rounded border-gray-300"
        />
        Có thông tin kết nối
      </label>
      {values.hasConnection && (
        <div className="grid grid-cols-3 gap-3 pl-1">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Loại</label>
            <select
              value={values.connectionType}
              onChange={(e) => onChange({ connectionType: e.target.value as PrinterConnectionType })}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            >
              {(Object.keys(CONNECTION_TYPE_LABEL) as PrinterConnectionType[]).map((t) => (
                <option key={t} value={t}>
                  {CONNECTION_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Địa chỉ (IP/host)</label>
            <input
              value={values.connectionAddress}
              onChange={(e) => onChange({ connectionAddress: e.target.value })}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tên spooler</label>
            <input
              value={values.connectionSpoolerName}
              onChange={(e) => onChange({ connectionSpoolerName: e.target.value })}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ngưỡng cảnh báo sắp hết phôi</label>
          <input
            type="number"
            min={0}
            value={values.lowStockThreshold}
            onChange={(e) => onChange({ lowStockThreshold: Number(e.target.value) })}
            className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Phôi in mặc định</label>
          <select
            value={values.defaultTemplateId}
            onChange={(e) => onChange({ defaultTemplateId: e.target.value })}
            className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
          >
            <option value="">— Không có —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

function CreatePrinterModal({ onClose, onCreated }: { onClose: () => void; onCreated: (printer: Printer) => void }) {
  const [values, setValues] = useState<PrinterFormValues>(() => initPrinterFormValues());
  const [blankStock, setBlankStock] = useState(0);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCardTemplates({ status: 'ACTIVE' })
      .then((r) => setTemplates(r.items))
      .catch(() => {}); // non-critical — the picker just shows empty rather than blocking the form
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!values.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      onCreated(await createPrinter({ ...buildPrinterInput(values), blankStock }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Thêm máy in" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        <PrinterFormFields values={values} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} templates={templates} />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Số phôi ban đầu</label>
          <input
            type="number"
            min={0}
            value={blankStock}
            onChange={(e) => setBlankStock(Number(e.target.value))}
            className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
          />
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
            {saving ? 'Đang lưu...' : 'Tạo máy in'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function PrinterDetailPage({ printerId, onBack }: { printerId: string; onBack: () => void }) {
  const [printer, setPrinter] = useState<PrinterDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [values, setValues] = useState<PrinterFormValues>(() => initPrinterFormValues());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);

  const [stockPage, setStockPage] = useState(1);
  const [stockPageSize, setStockPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [stockResult, setStockResult] = useState<Paginated<PrinterStockEvent> | null>(null);

  const load = () => {
    getPrinter(printerId)
      .then((p) => {
        setPrinter(p);
        setValues(initPrinterFormValues(p));
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(load, [printerId]);
  useEffect(() => {
    listCardTemplates({ status: 'ACTIVE' })
      .then((r) => setTemplates(r.items))
      .catch(() => {});
  }, []);

  const reloadStockEvents = () => {
    listPrinterStockEvents(printerId, { page: stockPage, limit: stockPageSize })
      .then(setStockResult)
      .catch((err) => setActionError(err instanceof ApiError ? err.message : String(err)));
  };
  useEffect(reloadStockEvents, [printerId, stockPage, stockPageSize]);

  async function saveFields(e: FormEvent) {
    e.preventDefault();
    if (!values.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updatePrinter(printerId, buildPrinterInput(values));
      setPrinter((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled() {
    if (!printer) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const updated = printer.status === 'DISABLED' ? await enablePrinter(printerId) : await disablePrinter(printerId);
      setPrinter((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function runTestPrint() {
    setActionBusy(true);
    setActionError(null);
    try {
      await testPrintPrinter(printerId);
      window.alert('Đã xác nhận máy in sẵn sàng.');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  if (loadError) {
    return (
      <div>
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 mb-4">
          ← Quay lại danh sách
        </button>
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">{loadError}</div>
      </div>
    );
  }

  if (!printer) return <p className="text-gray-500">Đang tải...</p>;

  return (
    <div className="max-w-4xl">
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 mb-2">
        ← Quay lại danh sách
      </button>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            {printer.name}
            <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_BADGE_CLASS[printer.status]}`}>
              {STATUS_LABEL[printer.status]}
            </span>
          </h1>
          {printer.lastError && <p className="text-sm text-red-600 mt-1">Lỗi gần nhất: {printer.lastError}</p>}
          <p className="text-xs text-gray-500 mt-1">Lần báo về gần nhất: {formatDateTime(printer.lastSeenAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void runTestPrint()}
            disabled={actionBusy || printer.status === 'DISABLED'}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-semibold disabled:opacity-50"
          >
            In thử
          </button>
          <button
            onClick={() => void toggleEnabled()}
            disabled={actionBusy}
            className={`px-3 py-1.5 rounded-lg border text-sm font-semibold disabled:opacity-50 ${
              printer.status === 'DISABLED'
                ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                : 'border-red-300 text-red-700 hover:bg-red-50'
            }`}
          >
            {printer.status === 'DISABLED' ? 'Kích hoạt lại' : 'Vô hiệu hóa'}
          </button>
        </div>
      </div>

      {actionError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-4">{actionError}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <p className="text-xs text-gray-500">Phôi còn lại</p>
          <p className={`text-2xl font-bold ${printer.lowStock ? 'text-red-600' : 'text-gray-900'}`}>{printer.blankStock}</p>
          {printer.lowStock && <p className="text-xs text-red-600 mt-0.5">Dưới ngưỡng {printer.lowStockThreshold} — sắp hết</p>}
          <button onClick={() => setStockOpen(true)} className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium">
            Nạp / điều chỉnh phôi
          </button>
        </div>
        <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <p className="text-xs text-gray-500">Token agent</p>
          <p className="text-lg font-semibold text-gray-900">{printer.hasToken ? 'Đã cấp' : 'Chưa cấp'}</p>
          <button onClick={() => setTokenOpen(true)} className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium">
            {printer.hasToken ? 'Cấp lại token mới' : 'Cấp token'}
          </button>
        </div>
        <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <p className="text-xs text-gray-500">Hàng chờ hiện tại</p>
          <p className="text-2xl font-bold text-gray-900">{printer.queueDepth}</p>
          <p className="text-xs text-gray-500 mt-0.5">thẻ đang chờ/đang in trên máy này</p>
        </div>
      </div>

      <form onSubmit={saveFields} className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3 mb-6">
        <h2 className="text-base font-semibold text-gray-900">Thông tin máy in</h2>
        <PrinterFormFields values={values} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} templates={templates} />
        {saveError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{saveError}</div>}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </form>

      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Lịch sử phôi</h2>
        {stockResult && stockResult.items.length === 0 && <p className="text-sm text-gray-500">Chưa có lịch sử thay đổi phôi.</p>}
        {stockResult && stockResult.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4">Thời gian</th>
                  <th className="py-2 pr-4">Lý do</th>
                  <th className="py-2 pr-4">Thay đổi</th>
                  <th className="py-2 pr-4">Còn lại</th>
                  <th className="py-2 pr-4">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {stockResult.items.map((ev) => (
                  <tr key={ev.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{formatDateTime(ev.at)}</td>
                    <td className="py-2 pr-4 text-gray-700">{STOCK_REASON_LABEL[ev.reason] ?? ev.reason}</td>
                    <td className={`py-2 pr-4 tabular-nums font-medium ${ev.delta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {ev.delta > 0 ? `+${ev.delta}` : ev.delta}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-gray-900">{ev.resultingStock}</td>
                    <td className="py-2 pr-4 text-gray-500">{ev.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          meta={stockResult?.meta}
          itemLabel="lần thay đổi"
          onPageChange={setStockPage}
          pageSize={stockPageSize}
          onPageSizeChange={(size) => {
            setStockPageSize(size);
            setStockPage(1);
          }}
        />
      </div>

      {stockOpen && (
        <StockAdjustModal
          printerId={printerId}
          currentStock={printer.blankStock}
          onClose={() => setStockOpen(false)}
          onAdjusted={() => {
            setStockOpen(false);
            load();
            reloadStockEvents();
          }}
        />
      )}

      {tokenOpen && (
        <IssueTokenModal
          printerId={printerId}
          onClose={() => {
            setTokenOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function StockAdjustModal({
  printerId,
  currentStock,
  onClose,
  onAdjusted,
}: {
  printerId: string;
  currentStock: number;
  onClose: () => void;
  onAdjusted: () => void;
}) {
  const [reason, setReason] = useState<PrinterStockAdjustReason>('REFILL');
  const [delta, setDelta] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (delta === 0) return;
    setSaving(true);
    setError(null);
    try {
      await adjustPrinterStock(printerId, { delta, reason, note: note.trim() || undefined });
      onAdjusted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Nạp / điều chỉnh phôi" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-500">Đang còn {currentStock} phôi.</p>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Lý do</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as PrinterStockAdjustReason)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            <option value="REFILL">Nạp phôi mới</option>
            <option value="ADJUST">Điều chỉnh (kiểm kê)</option>
            <option value="WASTE">Hao hụt/hỏng</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Số lượng thay đổi (âm để trừ)</label>
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value))}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Ghi chú (tuỳ chọn)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            type="submit"
            disabled={saving || delta === 0}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Xác nhận'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * One-time-reveal token UX, same convention as an API-key-creation dialog —
 * `PrinterController.issueToken`'s response is the ONLY time the plaintext
 * is ever available; once this modal closes there is no way to see it
 * again (only re-issuing, which invalidates it).
 */
function IssueTokenModal({ printerId, onClose }: { printerId: string; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async () => {
    setIssuing(true);
    setError(null);
    try {
      const res = await issuePrinterToken(printerId);
      setToken(res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setIssuing(false);
    }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      /* clipboard unavailable in this environment — the box below is still selectable text */
    }
  };

  return (
    <ModalShell title="Cấp token cho print-agent" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {!token && (
          <>
            <p className="text-gray-600">
              Token mới sẽ thay thế token cũ ngay lập tức — print-agent đang dùng token cũ (nếu có) sẽ ngừng xác thực
              được cho tới khi cập nhật token mới.
            </p>
            {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
                Huỷ
              </button>
              <button
                onClick={() => void issue()}
                disabled={issuing}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
              >
                {issuing ? 'Đang cấp...' : 'Cấp token mới'}
              </button>
            </div>
          </>
        )}
        {token && (
          <>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium">
              Chỉ hiển thị MỘT LẦN DUY NHẤT — hãy sao chép ngay. Sau khi đóng hộp thoại này, token sẽ không thể xem lại.
            </div>
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 font-mono text-xs break-all select-all">{token}</div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => void copy()}
                className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 font-semibold"
              >
                {copied ? 'Đã sao chép ✓' : 'Sao chép'}
              </button>
              <button onClick={onClose} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm">
                Đóng
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
