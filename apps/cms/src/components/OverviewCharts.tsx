import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { CampaignPhotoStats, CampaignsTimeseriesPoint, CampaignStatsSummaryItem } from '../api';
import { CATEGORICAL, CHROME, formatCount, METRIC_COLOR, STATUS } from '../chartTheme';

/**
 * Interactive dashboard-panel charts for the Overview page (2026-09-07 Power
 * BI–style redesign — see docs/ROADMAP.md). Built on `recharts` rather than
 * more hand-rolled inline SVG (the approach the first pass of this page
 * used): once the brief grew to a trend chart *and* upgraded comparison/
 * status charts, all needing a real crosshair/hover tooltip, legend, and
 * responsive sizing, hand-rolling that interactivity three times over would
 * have cost more than one well-established, tree-shakeable, React-idiomatic
 * charting library — `recharts` needs no CDN/runtime setup beyond the normal
 * `pnpm add`, and every chart below still renders as plain SVG under the
 * hood, so it composes with this app's existing Tailwind cards unchanged.
 * Colors all come from `chartTheme.ts` (the `dataviz` skill's validated
 * categorical/status palette) — never ad-hoc hex per chart.
 */

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "YYYY-MM-DD" -> "dd/MM", with no `Date`/timezone parsing involved — the string is already a calendar date, not an instant. */
function formatDayMonth(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${d}/${m}`;
}

/** A small swatch + label row, shared by every chart's legend below it — a line stroke for line series, a filled square for bar/status series, per the dataviz skill's "line keys for lines, rect keys for bars" rule. */
function LegendRow({ color, shape, label, value }: { color: string; shape: 'line' | 'rect'; label: string; value?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {shape === 'rect' ? (
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
      ) : (
        <span className="w-3 h-0.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      )}
      <span className="text-gray-500">{label}</span>
      {value !== undefined && <span className="font-semibold text-gray-900 tabular-nums">{value}</span>}
    </span>
  );
}

/** Tooltip shell every chart below reuses — a white card, values Strong/primary and leading, series name secondary and trailing (the legend's hierarchy inverted, since here the reader already has the series and wants the number). */
function TooltipCard({ title, rows }: { title: string; rows: { color: string; shape: 'line' | 'rect'; label: string; value: string }[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-md px-3 py-2 text-xs min-w-[9rem]">
      <div className="text-gray-500 mb-1.5">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-gray-600">
              {r.shape === 'rect' ? (
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
              ) : (
                <span className="w-2.5 h-0.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
              )}
              {r.label}
            </span>
            <span className="font-semibold text-gray-900 tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Day-bucketed trend line — the dashboard's headline time-series, backed by
 * the new `GET /v1/campaigns/stats/timeseries` endpoint (real device-event
 * timestamps, not synthetic data; see docs/ROADMAP.md for why this was
 * buildable). Two series sharing one axis (never a dual-axis chart), each
 * wearing the same hue its KPI card and the comparison chart use.
 */
export function SessionsTrendChart({ points }: { points: CampaignsTimeseriesPoint[] }) {
  function renderTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0 || typeof label !== 'string') return null;
    return (
      <TooltipCard
        title={formatDayMonth(label)}
        rows={[
          { color: CATEGORICAL.blue, shape: 'line', label: 'Session hoàn tất', value: formatCount(Number(payload[0]?.value ?? 0)) },
          { color: CATEGORICAL.aqua, shape: 'line', label: 'Upload thành công', value: formatCount(Number(payload[1]?.value ?? 0)) },
        ]}
      />
    );
  }

  return (
    <div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHROME.gridline} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDayMonth}
              tick={{ fontSize: 11, fill: CHROME.axisText }}
              axisLine={{ stroke: CHROME.gridline }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: CHROME.axisText }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip content={renderTooltip} cursor={{ stroke: CHROME.gridline, strokeWidth: 1 }} />
            <Line
              type="monotone"
              dataKey="sessionsCompleted"
              name="Session hoàn tất"
              stroke={CATEGORICAL.blue}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="uploadsSuccess"
              name="Upload thành công"
              stroke={CATEGORICAL.aqua}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs">
        <LegendRow color={CATEGORICAL.blue} shape="line" label="Session hoàn tất" />
        <LegendRow color={CATEGORICAL.aqua} shape="line" label="Upload thành công" />
      </div>
    </div>
  );
}

/**
 * Second trend line, same shape as `SessionsTrendChart` but for the
 * dashboard's "operational health" pair — retakes (chụp lại) and failed
 * uploads — which previously had zero time-series representation (only a
 * flat KPI total). Kept as its own chart rather than folded into
 * `SessionsTrendChart`'s single axis: sessions/uploads run one to two orders
 * of magnitude higher than retakes/upload failures, so sharing one y-axis
 * would flatten this pair into an unreadable line near zero (the
 * `choosing-a-form` guide's "two measures of different scale -> two charts
 * ... on one axis each" rule, not a dual-axis chart).
 */
export function QualityTrendChart({ points }: { points: CampaignsTimeseriesPoint[] }) {
  function renderTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0 || typeof label !== 'string') return null;
    return (
      <TooltipCard
        title={formatDayMonth(label)}
        rows={[
          { color: METRIC_COLOR.retakes, shape: 'line', label: 'Chụp lại', value: formatCount(Number(payload[0]?.value ?? 0)) },
          { color: METRIC_COLOR.uploadFailed, shape: 'line', label: 'Upload lỗi', value: formatCount(Number(payload[1]?.value ?? 0)) },
        ]}
      />
    );
  }

  return (
    <div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHROME.gridline} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDayMonth}
              tick={{ fontSize: 11, fill: CHROME.axisText }}
              axisLine={{ stroke: CHROME.gridline }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: CHROME.axisText }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip content={renderTooltip} cursor={{ stroke: CHROME.gridline, strokeWidth: 1 }} />
            <Line
              type="monotone"
              dataKey="retakes"
              name="Chụp lại"
              stroke={METRIC_COLOR.retakes}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="uploadsFailed"
              name="Upload lỗi"
              stroke={METRIC_COLOR.uploadFailed}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs">
        <LegendRow color={METRIC_COLOR.retakes} shape="line" label="Chụp lại" />
        <LegendRow color={METRIC_COLOR.uploadFailed} shape="line" label="Upload lỗi" />
      </div>
    </div>
  );
}

/**
 * Horizontal grouped bar chart — one row per campaign, comparing "Session
 * hoàn tất" against "Upload thành công" from `AllCampaignsStats.campaigns`.
 * Horizontal rather than vertical bars: a fixed-width label column reads
 * Vietnamese campaign names (which can run long) reliably, whereas rotated/
 * truncated x-axis labels on a vertical chart do not.
 */
export function CampaignComparisonChart({ campaigns }: { campaigns: CampaignStatsSummaryItem[] }) {
  function renderYTick({ x, y, payload }: { x: number; y: number; payload: { value: string } }) {
    const full = payload.value;
    return (
      <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill={CHROME.ink}>
        <title>{full}</title>
        {truncate(full, 18)}
      </text>
    );
  }

  function renderTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null;
    const sessions = payload.find((p) => p.dataKey === 'sessionsCompleted')?.value ?? 0;
    const uploads = payload.find((p) => p.dataKey === 'uploadSuccess')?.value ?? 0;
    return (
      <TooltipCard
        title={String(label)}
        rows={[
          { color: CATEGORICAL.blue, shape: 'rect', label: 'Session hoàn tất', value: formatCount(Number(sessions)) },
          { color: CATEGORICAL.aqua, shape: 'rect', label: 'Upload thành công', value: formatCount(Number(uploads)) },
        ]}
      />
    );
  }

  const height = Math.max(120, campaigns.length * 46 + 24);

  return (
    <div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <BarChart data={campaigns} layout="vertical" barCategoryGap="30%" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHROME.gridline} horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: CHROME.axisText }} axisLine={{ stroke: CHROME.gridline }} tickLine={false} />
            <YAxis
              type="category"
              dataKey="campaignName"
              width={130}
              tick={renderYTick as never}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
            <Bar dataKey="sessionsCompleted" name="Session hoàn tất" fill={CATEGORICAL.blue} barSize={11} radius={[0, 4, 4, 0]} />
            <Bar dataKey="uploadSuccess" name="Upload thành công" fill={CATEGORICAL.aqua} barSize={11} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs">
        <LegendRow color={CATEGORICAL.blue} shape="rect" label="Session hoàn tất" />
        <LegendRow color={CATEGORICAL.aqua} shape="rect" label="Upload thành công" />
      </div>
    </div>
  );
}

/**
 * Horizontal grouped bar chart — same shape as `CampaignComparisonChart`
 * (one row per campaign, fixed-width label column), but for the "chất
 * lượng" pair: retakes and CB Help interventions. These two metrics
 * previously existed only as flat KPI totals and raw table columns; this is
 * the per-campaign chart the product owner's "just numbers" complaint was
 * pointing at. Wears `METRIC_COLOR.retakes`/`cbHelp` — the same hues these
 * metrics use in the KPI row — rather than a new pair, per the "color
 * follows the entity" rule.
 */
export function CampaignQualityChart({ campaigns }: { campaigns: CampaignStatsSummaryItem[] }) {
  function renderYTick({ x, y, payload }: { x: number; y: number; payload: { value: string } }) {
    const full = payload.value;
    return (
      <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill={CHROME.ink}>
        <title>{full}</title>
        {truncate(full, 18)}
      </text>
    );
  }

  function renderTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null;
    const retakes = payload.find((p) => p.dataKey === 'retakes')?.value ?? 0;
    const cbHelp = payload.find((p) => p.dataKey === 'cbHelpInterventions')?.value ?? 0;
    return (
      <TooltipCard
        title={String(label)}
        rows={[
          { color: METRIC_COLOR.retakes, shape: 'rect', label: 'Chụp lại', value: formatCount(Number(retakes)) },
          { color: METRIC_COLOR.cbHelp, shape: 'rect', label: 'CB Help can thiệp', value: formatCount(Number(cbHelp)) },
        ]}
      />
    );
  }

  const height = Math.max(120, campaigns.length * 46 + 24);

  return (
    <div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <BarChart data={campaigns} layout="vertical" barCategoryGap="30%" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHROME.gridline} horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: CHROME.axisText }} axisLine={{ stroke: CHROME.gridline }} tickLine={false} />
            <YAxis
              type="category"
              dataKey="campaignName"
              width={130}
              tick={renderYTick as never}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
            <Bar dataKey="retakes" name="Chụp lại" fill={METRIC_COLOR.retakes} barSize={11} radius={[0, 4, 4, 0]} />
            <Bar dataKey="cbHelpInterventions" name="CB Help can thiệp" fill={METRIC_COLOR.cbHelp} barSize={11} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs">
        <LegendRow color={METRIC_COLOR.retakes} shape="rect" label="Chụp lại" />
        <LegendRow color={METRIC_COLOR.cbHelp} shape="rect" label="CB Help can thiệp" />
      </div>
    </div>
  );
}

/**
 * Part-to-whole breakdown of `AllCampaignsStats.totalPhotos` — a single
 * 100%-stacked horizontal bar rather than a donut. The `dataviz` skill
 * deprioritizes donuts in favor of stacked bars for part-to-whole reads, and
 * ready/pending/failed is genuinely a *status* breakdown (good/warning/
 * critical), not three arbitrary categories, so it wears the reserved status
 * palette instead of categorical hues. The 2px white seam between segments
 * (and around the bar) stands in for the skill's "surface gap" spacer, which
 * recharts has no native prop for.
 */
export function PhotoStatusBreakdown({ photos }: { photos: CampaignPhotoStats }) {
  const data = [{ name: 'Ảnh', ready: photos.ready, pending: photos.pending, failed: photos.failed }];

  function renderTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null;
    const pct = (v: number) => (photos.total > 0 ? `${Math.round((v / photos.total) * 100)}%` : '0%');
    const ready = Number(payload.find((p) => p.dataKey === 'ready')?.value ?? 0);
    const pending = Number(payload.find((p) => p.dataKey === 'pending')?.value ?? 0);
    const failed = Number(payload.find((p) => p.dataKey === 'failed')?.value ?? 0);
    return (
      <TooltipCard
        title="Trạng thái ảnh"
        rows={[
          { color: STATUS.good, shape: 'rect', label: 'Sẵn sàng', value: `${formatCount(ready)} (${pct(ready)})` },
          { color: STATUS.warning, shape: 'rect', label: 'Đang chờ', value: `${formatCount(pending)} (${pct(pending)})` },
          { color: STATUS.critical, shape: 'rect', label: 'Lỗi', value: `${formatCount(failed)} (${pct(failed)})` },
        ]}
      />
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-3xl font-bold tabular-nums text-gray-900">{formatCount(photos.total)}</span>
        <span className="text-sm text-gray-500">ảnh</span>
      </div>

      <div style={{ width: '100%', height: 40 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, photos.total || 1]} />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
            <Bar dataKey="ready" stackId="a" fill={STATUS.good} stroke="#fff" strokeWidth={2} radius={[4, 0, 0, 4]} barSize={28} />
            <Bar dataKey="pending" stackId="a" fill={STATUS.warning} stroke="#fff" strokeWidth={2} barSize={28} />
            <Bar dataKey="failed" stackId="a" fill={STATUS.critical} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} barSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-sm">
        <li><LegendRow color={STATUS.good} shape="rect" label="Sẵn sàng" value={formatCount(photos.ready)} /></li>
        <li><LegendRow color={STATUS.warning} shape="rect" label="Đang chờ" value={formatCount(photos.pending)} /></li>
        <li><LegendRow color={STATUS.critical} shape="rect" label="Lỗi" value={formatCount(photos.failed)} /></li>
      </ul>
    </div>
  );
}

/**
 * Part-to-whole breakdown of upload outcomes (`totalUploadSuccess` vs.
 * `totalUploadFailed`) — same 100%-stacked-bar treatment as
 * `PhotoStatusBreakdown` right above it, so the two "outcome" panels in this
 * dashboard read as one family. `totalUploadFailed` previously had no chart
 * anywhere on this page (only a flat KPI number and a raw table column);
 * this is that number's first real visual. Two segments, not three — success
 * wears the metric's own categorical hue (aqua, same as its KPI card/trend
 * line/comparison bar) and failed wears the reserved `STATUS.critical` red,
 * matching `METRIC_COLOR`'s existing entity-color assignments exactly.
 */
export function UploadOutcomeBreakdown({ uploadSuccess, uploadFailed }: { uploadSuccess: number; uploadFailed: number }) {
  const total = uploadSuccess + uploadFailed;
  const data = [{ name: 'Upload', success: uploadSuccess, failed: uploadFailed }];

  function renderTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null;
    const pct = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : '0%');
    const success = Number(payload.find((p) => p.dataKey === 'success')?.value ?? 0);
    const failed = Number(payload.find((p) => p.dataKey === 'failed')?.value ?? 0);
    return (
      <TooltipCard
        title="Kết quả upload"
        rows={[
          { color: METRIC_COLOR.uploadSuccess, shape: 'rect', label: 'Thành công', value: `${formatCount(success)} (${pct(success)})` },
          { color: METRIC_COLOR.uploadFailed, shape: 'rect', label: 'Thất bại', value: `${formatCount(failed)} (${pct(failed)})` },
        ]}
      />
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-3xl font-bold tabular-nums text-gray-900">{formatCount(total)}</span>
        <span className="text-sm text-gray-500">lượt upload</span>
      </div>

      <div style={{ width: '100%', height: 40 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, total || 1]} />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
            <Bar dataKey="success" stackId="a" fill={METRIC_COLOR.uploadSuccess} stroke="#fff" strokeWidth={2} radius={[4, 0, 0, 4]} barSize={28} />
            <Bar dataKey="failed" stackId="a" fill={METRIC_COLOR.uploadFailed} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} barSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-sm">
        <li><LegendRow color={METRIC_COLOR.uploadSuccess} shape="rect" label="Thành công" value={formatCount(uploadSuccess)} /></li>
        <li><LegendRow color={METRIC_COLOR.uploadFailed} shape="rect" label="Thất bại" value={formatCount(uploadFailed)} /></li>
      </ul>
    </div>
  );
}

/** Reusable dashboard-panel chrome — title + optional subtitle + body, the same card treatment for every chart/table panel in the grid. */
export function DashboardPanel({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`p-5 rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5 mb-1">{subtitle}</p>}
      <div className={subtitle ? 'mt-3' : 'mt-4'}>{children}</div>
    </div>
  );
}
