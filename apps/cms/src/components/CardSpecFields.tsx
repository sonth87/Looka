import type { CardSpec } from '../api';

const CARD_SIZE_OPTIONS = ['3x4', '4x6'];
const CARD_DPI_OPTIONS = [300, 600];
const RETOUCH_STRENGTHS: NonNullable<CardSpec['retouch']>['strength'][] = ['LIGHT', 'MEDIUM', 'STRONG'];
const RETOUCH_STRENGTH_LABEL: Record<string, string> = { LIGHT: 'Nhẹ', MEDIUM: 'Vừa', STRONG: 'Mạnh' };

export const DEFAULT_CARD_SPEC: Required<
  Pick<CardSpec, 'size' | 'dpi' | 'backgroundColor' | 'headHeightRatio' | 'eyeLineRatio'>
> & {
  retouch: NonNullable<CardSpec['retouch']>;
} = {
  size: '4x6',
  dpi: 300,
  backgroundColor: '#FFFFFF',
  headHeightRatio: [0.7, 0.8],
  eyeLineRatio: [0.4, 0.45],
  retouch: { enabled: true, strength: 'LIGHT' },
};

/**
 * "Chuẩn ảnh thẻ" (card-photo spec) field group — cỡ/dpi/nền/làm mịn/tỉ lệ
 * crop + a small live preview swatch. Extracted from `CampaignForm.tsx`'s
 * "3. Ảnh thẻ" section (2026-09-09, item 10) so `CaptureConfigurationsPage`
 * can reuse the exact same fields for a capture configuration's own
 * (optional) card spec, without duplicating ~150 lines of near-identical
 * form markup. Pure controlled-component — the caller owns `cardSpec` state
 * and persistence; this only renders inputs and calls `onChange`.
 */
export function CardSpecFields({
  cardSpec,
  onChange,
}: {
  cardSpec: CardSpec;
  onChange: (updater: (prev: CardSpec) => CardSpec) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Cỡ ảnh</label>
          <select
            value={cardSpec.size ?? '4x6'}
            onChange={(e) => onChange((s) => ({ ...s, size: e.target.value }))}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            {CARD_SIZE_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v} cm
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">DPI</label>
          <select
            value={cardSpec.dpi ?? 300}
            onChange={(e) => onChange((s) => ({ ...s, dpi: Number(e.target.value) }))}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            {CARD_DPI_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">Màu nền</label>
        <input
          type="color"
          value={cardSpec.backgroundColor ?? '#FFFFFF'}
          onChange={(e) => onChange((s) => ({ ...s, backgroundColor: e.target.value }))}
          className="w-10 h-8 rounded border border-gray-300"
        />
        <span className="text-xs text-gray-500 font-mono">{cardSpec.backgroundColor ?? '#FFFFFF'}</span>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cardSpec.retouch?.enabled ?? true}
            onChange={(e) => onChange((s) => ({ ...s, retouch: { ...s.retouch, enabled: e.target.checked } }))}
            className="rounded border-gray-300"
          />
          Làm mịn
        </label>
        {cardSpec.retouch?.enabled && (
          <select
            value={cardSpec.retouch?.strength ?? 'LIGHT'}
            onChange={(e) =>
              onChange((s) => ({
                ...s,
                retouch: { ...s.retouch, strength: e.target.value as NonNullable<CardSpec['retouch']>['strength'] },
              }))
            }
            className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900"
          >
            {RETOUCH_STRENGTHS.map((v) => (
              <option key={v} value={v}>
                {RETOUCH_STRENGTH_LABEL[v as string]}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tỉ lệ chiều cao đầu (0–1)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={cardSpec.headHeightRatio?.[0] ?? 0.7}
              onChange={(e) =>
                onChange((s) => ({
                  ...s,
                  headHeightRatio: [Number(e.target.value), s.headHeightRatio?.[1] ?? 0.8],
                }))
              }
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            />
            <span className="text-gray-400">–</span>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={cardSpec.headHeightRatio?.[1] ?? 0.8}
              onChange={(e) =>
                onChange((s) => ({
                  ...s,
                  headHeightRatio: [s.headHeightRatio?.[0] ?? 0.7, Number(e.target.value)],
                }))
              }
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tỉ lệ đường mắt (0–1, từ trên xuống)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={cardSpec.eyeLineRatio?.[0] ?? 0.4}
              onChange={(e) =>
                onChange((s) => ({ ...s, eyeLineRatio: [Number(e.target.value), s.eyeLineRatio?.[1] ?? 0.45] }))
              }
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            />
            <span className="text-gray-400">–</span>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={cardSpec.eyeLineRatio?.[1] ?? 0.45}
              onChange={(e) =>
                onChange((s) => ({ ...s, eyeLineRatio: [s.eyeLineRatio?.[0] ?? 0.4, Number(e.target.value)] }))
              }
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            />
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-500 mb-1.5">Xem trước khung crop (minh hoạ, không dùng ảnh thật)</div>
        <div
          className="relative w-28 rounded-lg border border-gray-300 overflow-hidden"
          style={{ aspectRatio: '2 / 3', backgroundColor: cardSpec.backgroundColor ?? '#FFFFFF' }}
        >
          <div
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-gray-300"
            style={{
              bottom: 0,
              width: '55%',
              height: `${(cardSpec.headHeightRatio?.[1] ?? 0.8) * 100}%`,
            }}
          />
          <div
            className="absolute left-0 right-0 border-t border-dashed border-blue-400"
            style={{ top: `${(cardSpec.eyeLineRatio?.[0] ?? 0.4) * 100}%` }}
          />
        </div>
      </div>
    </>
  );
}
