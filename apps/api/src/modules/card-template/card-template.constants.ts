export type CardTemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type CardTemplateAssetKind = 'LOGO' | 'BACKGROUND' | 'FONT';
export type CardTemplateFieldType = 'TEXT' | 'DATE' | 'IMAGE';

/**
 * Catalog of `field` values a TEXT/BARCODE/PHOTO layout element may
 * reference — cms-8-screens-api-plan.md §2.6's exact list. Fixed in code
 * (not a DB table, unlike `capture_angle_presets`/`photo_kinds`, E1):
 * adding a real new data source (e.g. a second phone number) is a code
 * change to `CardTemplateRenderService.resolveFieldValues` anyway, so a
 * catalog table would not remove that step, only add one more place to
 * keep in sync. Served over `GET /v1/card-templates/fields` so the CMS can
 * build its field picker without hardcoding this list itself.
 */
export const CARD_TEMPLATE_FIELD_CODES = [
  'fullName',
  'studentCode',
  'citizenId',
  'className',
  'faculty',
  'major',
  'dateOfBirth',
  'cardValidUntil',
  'cohort',
  'campaignCode',
  'cardPhoto',
  'qrPayload',
] as const;
export type CardTemplateFieldCode = (typeof CARD_TEMPLATE_FIELD_CODES)[number];

export const CARD_TEMPLATE_FIELDS: ReadonlyArray<{
  field: CardTemplateFieldCode;
  label: string;
  type: CardTemplateFieldType;
}> = [
  { field: 'fullName', label: 'Họ và tên', type: 'TEXT' },
  { field: 'studentCode', label: 'Mã sinh viên', type: 'TEXT' },
  { field: 'citizenId', label: 'Số CCCD', type: 'TEXT' },
  { field: 'className', label: 'Lớp', type: 'TEXT' },
  { field: 'faculty', label: 'Khoa', type: 'TEXT' },
  { field: 'major', label: 'Ngành', type: 'TEXT' },
  { field: 'dateOfBirth', label: 'Ngày sinh', type: 'DATE' },
  { field: 'cardValidUntil', label: 'Thời hạn thẻ', type: 'DATE' },
  { field: 'cohort', label: 'Khóa', type: 'TEXT' },
  { field: 'campaignCode', label: 'Mã đợt chụp', type: 'TEXT' },
  { field: 'cardPhoto', label: 'Ảnh thẻ', type: 'IMAGE' },
  {
    field: 'qrPayload',
    label: 'Dữ liệu mã QR/vạch (mặc định = mã sinh viên)',
    type: 'TEXT',
  },
];

export const ASSET_KINDS: readonly CardTemplateAssetKind[] = [
  'LOGO',
  'BACKGROUND',
  'FONT',
];

/** `image/*` for LOGO/BACKGROUND; common font container types for FONT — the render engine embeds these via `@font-face` (see `CardTemplateRenderService.loadFontFaces`), keyed by file name without extension. */
export const ASSET_MIME_TYPES: Record<
  CardTemplateAssetKind,
  readonly string[]
> = {
  LOGO: ['image/png', 'image/jpeg', 'image/svg+xml'],
  BACKGROUND: ['image/png', 'image/jpeg', 'image/svg+xml'],
  FONT: [
    'font/ttf',
    'font/otf',
    'font/woff',
    'font/woff2',
    'application/font-woff',
    'application/x-font-ttf',
    'application/octet-stream',
  ],
};

export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

export const BARCODE_SYMBOLOGIES = ['CODE128', 'QRCODE'] as const;
export type CardTemplateBarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];

export const DEFAULT_CARD_WIDTH_MM = 85.6;
export const DEFAULT_CARD_HEIGHT_MM = 54;
export const DEFAULT_DPI = 300;
export const ALLOWED_DPI: readonly number[] = [300, 600];

/**
 * Fallback values `CardTemplateRenderService` uses for any field the
 * caller's `sampleData` (preview without a real `setId`) leaves out —
 * every preview render always has SOMETHING to show for every field on
 * the layout, never a blank/undefined string.
 */
export const SAMPLE_PREVIEW_DATA: Record<CardTemplateFieldCode, string> = {
  fullName: 'NGUYỄN VĂN A',
  studentCode: '2074010001',
  citizenId: '001204012345',
  className: '15.01',
  faculty: 'Công nghệ thông tin',
  major: 'Kỹ thuật phần mềm',
  dateOfBirth: '01/01/2004',
  cardValidUntil: '2028',
  cohort: 'K15',
  campaignCode: 'CMP-SAMPLE',
  cardPhoto: '',
  qrPayload: '2074010001',
};
