import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  CardTemplateAssetDao,
  CardTemplateAssetKind,
  CardTemplateBarcodeElement,
  CardTemplateDetail,
  CardTemplateElement,
  CardTemplateField,
  CardTemplateFieldCode,
  CardTemplateFont,
  CardTemplateImageElement,
  CardTemplateSide,
  CardTemplateStaticTextElement,
  CardTemplateTextElement,
  UpdateCardTemplateInput,
  archiveCardTemplate,
  deleteCardTemplate,
  deleteCardTemplateAsset,
  duplicateCardTemplate,
  getCardTemplate,
  listCardTemplateFields,
  previewCardTemplateUrl,
  publishCardTemplate,
  updateCardTemplate,
  uploadCardTemplateAsset,
} from '../api';
import { CardPreviewModal } from '../print/CardPreviewModal';
import { CARD_TEMPLATE_STATUS_BADGE_CLASS, CARD_TEMPLATE_STATUS_LABEL } from './CardTemplatesPage';

const ASSET_KIND_OPTIONS: CardTemplateAssetKind[] = ['LOGO', 'BACKGROUND', 'FONT'];
const ELEMENT_TYPES: CardTemplateElement['type'][] = ['PHOTO', 'TEXT', 'BARCODE', 'IMAGE', 'STATIC_TEXT'];
const ELEMENT_TYPE_LABEL: Record<CardTemplateElement['type'], string> = {
  PHOTO: 'Ảnh thẻ',
  TEXT: 'Văn bản (theo trường dữ liệu)',
  BARCODE: 'Mã vạch / QR',
  IMAGE: 'Hình ảnh (asset)',
  STATIC_TEXT: 'Văn bản tĩnh',
};

let elementCounter = 0;
function makeElementId(): string {
  elementCounter += 1;
  return `el-${elementCounter}-${Date.now().toString(36)}`;
}

function defaultFont(): CardTemplateFont {
  return { family: 'Arial', size: 10, color: '#000000' };
}

function defaultElement(type: CardTemplateElement['type'], z: number): CardTemplateElement {
  const base = { id: makeElementId(), x: 5, y: 5, w: 30, h: 10, unit: 'mm' as const, z };
  switch (type) {
    case 'PHOTO':
      return { ...base, type: 'PHOTO', field: 'cardPhoto' };
    case 'TEXT':
      return { ...base, type: 'TEXT', field: 'fullName', font: defaultFont(), align: 'left', uppercase: false };
    case 'BARCODE':
      return { ...base, type: 'BARCODE', field: 'qrPayload', symbology: 'QRCODE' };
    case 'IMAGE':
      return { ...base, type: 'IMAGE', assetId: '' };
    case 'STATIC_TEXT':
      return { ...base, type: 'STATIC_TEXT', text: '', font: defaultFont(), align: 'left' };
  }
}

/**
 * `/card-templates/:id` (Task C) — detail/edit page: basic info, lifecycle
 * actions (publish/archive/duplicate/delete), asset management, and a
 * form-based layout editor for `front`/`back` independently.
 *
 * Deliberately NOT a drag-and-drop canvas — this codebase has no DnD
 * library and `CaptureAnglesTable.tsx`'s own reorder feature (up/down
 * buttons, not drag handles) sets the precedent for avoiding one here too.
 * Element ordering (z-index) is a plain number input per element instead —
 * matching the actual `z: number` field the layout schema already has,
 * rather than inventing a list-position concept the backend doesn't store.
 */
export function CardTemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<CardTemplateDetail | null>(null);
  const [fields, setFields] = useState<CardTemplateField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  function reload() {
    if (!id) return;
    setError(null);
    getCardTemplate(id)
      .then(setTemplate)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }

  useEffect(reload, [id]);
  useEffect(() => {
    listCardTemplateFields().then(setFields).catch(() => {});
  }, []);

  if (!id) return null;
  if (error && !template) return <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>;
  if (!template) return <p className="text-gray-500">Đang tải...</p>;

  return (
    <div className="space-y-6 pb-12">
      <div>
        <Link to="/card-templates" className="text-gray-500 hover:text-gray-700 mb-4 inline-block text-sm">
          ← Danh sách phôi thẻ
        </Link>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h1 className="text-xl font-bold text-gray-900">{template.name}</h1>
          <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${CARD_TEMPLATE_STATUS_BADGE_CLASS[template.status]}`}>
            {CARD_TEMPLATE_STATUS_LABEL[template.status]}
          </span>
          <span className="text-xs text-gray-400">v{template.version} · đã dùng {template.usageCount} lần</span>
        </div>
        <p className="text-sm text-gray-500 font-mono">{template.code}</p>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      <LifecycleActions
        template={template}
        onChanged={setTemplate}
        onDeleted={() => navigate('/card-templates')}
        onPreview={() => setPreviewing(true)}
        onError={setError}
      />

      <BasicInfoPanel template={template} onSaved={setTemplate} />

      <AssetsPanel template={template} onSaved={setTemplate} />

      <LayoutPanel side="front" title="Bố cục mặt trước" template={template} fields={fields} onSaved={setTemplate} />
      <LayoutPanel side="back" title="Bố cục mặt sau" template={template} fields={fields} onSaved={setTemplate} />

      {previewing && (
        <CardPreviewModal
          title={`Xem trước — ${template.name}`}
          fetchUrl={(side) => previewCardTemplateUrl(template.id, { sampleData: {}, side })}
          onClose={() => setPreviewing(false)}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

function LifecycleActions({
  template,
  onChanged,
  onDeleted,
  onPreview,
  onError,
}: {
  template: CardTemplateDetail;
  onChanged: (t: CardTemplateDetail) => void;
  onDeleted: () => void;
  onPreview: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<CardTemplateDetail>) {
    setBusy(true);
    try {
      onChanged(await action());
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Xóa phôi "${template.name}"? Không thể hoàn tác.`)) return;
    setBusy(true);
    try {
      await deleteCardTemplate(template.id);
      onDeleted();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  }

  const canDelete = template.status === 'DRAFT' && template.usageCount === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onPreview}
        className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium"
      >
        Xem trước
      </button>
      {template.status === 'DRAFT' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => publishCardTemplate(template.id))}
          className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
        >
          Publish
        </button>
      )}
      {template.status !== 'ARCHIVED' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => archiveCardTemplate(template.id))}
          className="px-3 py-2 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 text-sm font-medium disabled:opacity-50"
        >
          Lưu trữ
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => duplicateCardTemplate(template.id))}
        className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
      >
        Nhân bản
      </button>
      <span
        className="ml-auto"
        title={!canDelete ? 'Chỉ được xóa phôi ở trạng thái Nháp và chưa từng dùng để in' : undefined}
      >
        <button
          type="button"
          disabled={!canDelete || busy}
          onClick={() => void handleDelete()}
          className="px-3 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          Xóa phôi
        </button>
      </span>
    </div>
  );
}

function BasicInfoPanel({ template, onSaved }: { template: CardTemplateDetail; onSaved: (t: CardTemplateDetail) => void }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [widthMm, setWidthMm] = useState(template.cardSize.widthMm);
  const [heightMm, setHeightMm] = useState(template.cardSize.heightMm);
  const [dpi, setDpi] = useState<300 | 600>(template.dpi === 600 ? 600 : 300);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = template.status === 'ARCHIVED';

  useEffect(() => {
    setName(template.name);
    setDescription(template.description ?? '');
    setWidthMm(template.cardSize.widthMm);
    setHeightMm(template.cardSize.heightMm);
    setDpi(template.dpi === 600 ? 600 : 300);
  }, [template.id]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await updateCardTemplate(template.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          cardSize: { widthMm, heightMm },
          dpi,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Thông tin cơ bản">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tên phôi</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={readOnly}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Mô tả</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readOnly}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rộng (mm)</label>
          <input
            type="number"
            step="0.1"
            value={widthMm}
            onChange={(e) => setWidthMm(Number(e.target.value))}
            disabled={readOnly}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Cao (mm)</label>
          <input
            type="number"
            step="0.1"
            value={heightMm}
            onChange={(e) => setHeightMm(Number(e.target.value))}
            disabled={readOnly}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">DPI</label>
          <select
            value={dpi}
            onChange={(e) => setDpi(Number(e.target.value) as 300 | 600)}
            disabled={readOnly}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:bg-gray-50"
          >
            <option value={300}>300</option>
            <option value={600}>600</option>
          </select>
        </div>
      </div>
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      {!readOnly && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={() => void save()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Lưu thông tin'}
          </button>
        </div>
      )}
    </Section>
  );
}

function AssetsPanel({ template, onSaved }: { template: CardTemplateDetail; onSaved: (t: CardTemplateDetail) => void }) {
  const [kind, setKind] = useState<CardTemplateAssetKind>('LOGO');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = template.status === 'ARCHIVED';

  async function refetch() {
    onSaved(await getCardTemplate(template.id));
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadCardTemplateAsset(template.id, file, kind);
      setFile(null);
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(assetId: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteCardTemplateAsset(template.id, assetId);
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Asset (logo / nền / font)">
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
        {template.assets.map((asset: CardTemplateAssetDao) => (
          <div key={asset.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium mr-2">{asset.kind}</span>
              <span className="text-gray-900">{asset.fileName}</span>
              <span className="text-gray-400 ml-2 text-xs">
                {asset.mimeType}
                {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
              </span>
            </div>
            {!readOnly && (
              <button type="button" disabled={busy} onClick={() => void remove(asset.id)} className="text-red-600 hover:text-red-800 text-xs font-medium">
                Xóa
              </button>
            )}
          </div>
        ))}
        {template.assets.length === 0 && <p className="px-3 py-4 text-center text-gray-400 text-sm">Chưa có asset nào.</p>}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as CardTemplateAssetKind)} className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900">
            {ASSET_KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-gray-600" />
          <button
            type="button"
            disabled={busy || !file}
            onClick={() => void upload()}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
          >
            Tải lên
          </button>
        </div>
      )}
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
    </Section>
  );
}

function LayoutPanel({
  side,
  title,
  template,
  fields,
  onSaved,
}: {
  side: 'front' | 'back';
  title: string;
  template: CardTemplateDetail;
  fields: CardTemplateField[];
  onSaved: (t: CardTemplateDetail) => void;
}) {
  const [localSide, setLocalSide] = useState<CardTemplateSide>(template[side]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = template.status === 'ARCHIVED';

  // Reset only when switching to a different template/side, not on every
  // parent re-render (e.g. an asset upload or the OTHER side's save both
  // refresh `template` via `getCardTemplate`) — otherwise in-progress,
  // unsaved edits on this side would be silently wiped by an unrelated
  // action elsewhere on the page.
  useEffect(() => {
    setLocalSide(template[side]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, side]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: UpdateCardTemplateInput = side === 'front' ? { front: localSide } : { back: localSide };
      onSaved(await updateCardTemplate(template.id, payload));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function addElement(type: CardTemplateElement['type']) {
    const nextZ = localSide.elements.length > 0 ? Math.max(...localSide.elements.map((e) => e.z)) + 1 : 1;
    setLocalSide({ ...localSide, elements: [...localSide.elements, defaultElement(type, nextZ)] });
  }

  function updateElement(index: number, next: CardTemplateElement) {
    setLocalSide({ ...localSide, elements: localSide.elements.map((e, i) => (i === index ? next : e)) });
  }

  function removeElement(index: number) {
    setLocalSide({ ...localSide, elements: localSide.elements.filter((_, i) => i !== index) });
  }

  const backgroundAssets = template.assets.filter((a) => a.kind === 'BACKGROUND');
  const imageAssets = template.assets.filter((a) => a.kind !== 'FONT');

  return (
    <Section title={title}>
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Màu nền</label>
          <input
            type="color"
            value={localSide.background.color}
            disabled={readOnly}
            onChange={(e) => setLocalSide({ ...localSide, background: { ...localSide.background, color: e.target.value } })}
            className="w-16 h-9 rounded border border-gray-300 bg-white"
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-gray-500 mb-1">Ảnh nền (asset kind=BACKGROUND)</label>
          <select
            value={localSide.background.assetId ?? ''}
            disabled={readOnly}
            onChange={(e) => setLocalSide({ ...localSide, background: { ...localSide.background, assetId: e.target.value || null } })}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          >
            <option value="">— Không dùng ảnh nền —</option>
            {backgroundAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fileName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {localSide.elements.map((element, index) => (
          <ElementEditor
            key={element.id}
            element={element}
            fields={fields}
            imageAssets={imageAssets}
            readOnly={readOnly}
            onChange={(next) => updateElement(index, next)}
            onRemove={() => removeElement(index)}
          />
        ))}
        {localSide.elements.length === 0 && <p className="text-center text-gray-400 text-sm py-3">Chưa có phần tử nào trong bố cục này.</p>}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-gray-500">+ Thêm phần tử:</span>
          {ELEMENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addElement(type)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-medium"
            >
              {ELEMENT_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      )}

      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {!readOnly && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Lưu bố cục'}
          </button>
        </div>
      )}
      <p className="text-xs text-gray-400">
        Lưu ý: "Xem trước" render từ bố cục ĐÃ LƯU trong CSDL — chỉnh sửa ở trên chưa lưu sẽ không hiện trong bản xem trước cho tới khi bấm "Lưu bố cục".
      </p>
    </Section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
      />
    </div>
  );
}

function FieldSelect({
  fields,
  value,
  onChange,
  disabled,
}: {
  fields: CardTemplateField[];
  value: CardTemplateFieldCode;
  onChange: (field: CardTemplateFieldCode) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-1">Trường dữ liệu</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as CardTemplateFieldCode)}
        className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
      >
        {fields.map((f) => (
          <option key={f.field} value={f.field}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FontEditor({
  font,
  align,
  onFontChange,
  onAlignChange,
  disabled,
}: {
  font: CardTemplateFont;
  align: 'left' | 'center' | 'right';
  onFontChange: (font: CardTemplateFont) => void;
  onAlignChange: (align: 'left' | 'center' | 'right') => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div>
        <label className="block text-[11px] text-gray-500 mb-1">Font chữ</label>
        <input
          value={font.family}
          disabled={disabled}
          onChange={(e) => onFontChange({ ...font, family: e.target.value })}
          className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
        />
      </div>
      <NumberField label="Cỡ chữ" value={font.size} step={1} disabled={disabled} onChange={(size) => onFontChange({ ...font, size })} />
      <div>
        <label className="block text-[11px] text-gray-500 mb-1">Màu chữ</label>
        <input
          type="color"
          value={font.color}
          disabled={disabled}
          onChange={(e) => onFontChange({ ...font, color: e.target.value })}
          className="w-16 h-9 rounded border border-gray-300 bg-white"
        />
      </div>
      <div>
        <label className="block text-[11px] text-gray-500 mb-1">Căn lề</label>
        <select
          value={align}
          disabled={disabled}
          onChange={(e) => onAlignChange(e.target.value as 'left' | 'center' | 'right')}
          className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
        >
          <option value="left">Trái</option>
          <option value="center">Giữa</option>
          <option value="right">Phải</option>
        </select>
      </div>
    </div>
  );
}

function ElementEditor({
  element,
  fields,
  imageAssets,
  readOnly,
  onChange,
  onRemove,
}: {
  element: CardTemplateElement;
  fields: CardTemplateField[];
  imageAssets: CardTemplateAssetDao[];
  readOnly: boolean;
  onChange: (next: CardTemplateElement) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-gray-200 rounded-xl p-3 space-y-2.5 bg-white">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{ELEMENT_TYPE_LABEL[element.type]}</span>
        {!readOnly && (
          <button type="button" onClick={onRemove} className="text-red-600 hover:text-red-800 text-xs font-medium">
            Xóa
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <NumberField label="X (mm)" value={element.x} disabled={readOnly} onChange={(x) => onChange({ ...element, x })} />
        <NumberField label="Y (mm)" value={element.y} disabled={readOnly} onChange={(y) => onChange({ ...element, y })} />
        <NumberField label="Rộng (mm)" value={element.w} disabled={readOnly} onChange={(w) => onChange({ ...element, w })} />
        <NumberField label="Cao (mm)" value={element.h} disabled={readOnly} onChange={(h) => onChange({ ...element, h })} />
        <NumberField label="Lớp (z)" value={element.z} step={1} disabled={readOnly} onChange={(z) => onChange({ ...element, z })} />
      </div>

      {element.type === 'PHOTO' && <p className="text-xs text-gray-500">Trường cố định: Ảnh thẻ (cardPhoto).</p>}

      {element.type === 'TEXT' && (
        <>
          <FieldSelect fields={fields} value={element.field} disabled={readOnly} onChange={(field) => onChange({ ...element, field } as CardTemplateTextElement)} />
          <FontEditor
            font={element.font}
            align={element.align}
            disabled={readOnly}
            onFontChange={(font) => onChange({ ...element, font })}
            onAlignChange={(align) => onChange({ ...element, align })}
          />
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={element.uppercase}
              disabled={readOnly}
              onChange={(e) => onChange({ ...element, uppercase: e.target.checked })}
              className="rounded border-gray-300"
            />
            Viết hoa toàn bộ
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={!!element.autoShrink}
              disabled={readOnly}
              onChange={(e) =>
                onChange({
                  ...element,
                  autoShrink: e.target.checked ? { minSize: 8, maxChars: 30 } : undefined,
                })
              }
              className="rounded border-gray-300"
            />
            Tự thu nhỏ cỡ chữ khi nội dung dài
          </label>
          {element.autoShrink && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Cỡ chữ nhỏ nhất"
                value={element.autoShrink.minSize}
                disabled={readOnly}
                onChange={(minSize) => onChange({ ...element, autoShrink: { ...element.autoShrink!, minSize } })}
              />
              <NumberField
                label="Số ký tự tối đa"
                value={element.autoShrink.maxChars}
                step={1}
                disabled={readOnly}
                onChange={(maxChars) => onChange({ ...element, autoShrink: { ...element.autoShrink!, maxChars } })}
              />
            </div>
          )}
        </>
      )}

      {element.type === 'BARCODE' && (
        <div className="grid grid-cols-2 gap-2">
          <FieldSelect fields={fields} value={element.field} disabled={readOnly} onChange={(field) => onChange({ ...element, field } as CardTemplateBarcodeElement)} />
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Loại mã</label>
            <select
              value={element.symbology}
              disabled={readOnly}
              onChange={(e) => onChange({ ...element, symbology: e.target.value as 'CODE128' | 'QRCODE' })}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
            >
              <option value="CODE128">CODE128</option>
              <option value="QRCODE">QRCODE</option>
            </select>
          </div>
        </div>
      )}

      {element.type === 'IMAGE' && (
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Asset hình ảnh</label>
          <select
            value={element.assetId}
            disabled={readOnly}
            onChange={(e) => onChange({ ...element, assetId: e.target.value } as CardTemplateImageElement)}
            className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
          >
            <option value="">— Chọn asset —</option>
            {imageAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fileName} ({a.kind})
              </option>
            ))}
          </select>
        </div>
      )}

      {element.type === 'STATIC_TEXT' && (
        <>
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Nội dung</label>
            <input
              value={element.text}
              disabled={readOnly}
              onChange={(e) => onChange({ ...element, text: e.target.value } as CardTemplateStaticTextElement)}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
            />
          </div>
          <FontEditor
            font={element.font}
            align={element.align}
            disabled={readOnly}
            onFontChange={(font) => onChange({ ...element, font })}
            onAlignChange={(align) => onChange({ ...element, align })}
          />
        </>
      )}
    </div>
  );
}
