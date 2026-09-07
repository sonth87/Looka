import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { formatCount } from '../chartTheme';

/**
 * A 12-14 point sparkline for a KPI card's trend indicator (dataviz skill's
 * stat-tile contract) — the line itself stays in the metric's accent hue at
 * reduced opacity (a de-emphasized echo of the big number above it), with
 * only the latest point drawn as a solid dot in the full accent color, so
 * "today" reads as the one point that matters. No axes/gridlines/tooltip:
 * a sparkline is a shape, not a chart to interrogate — the real numbers are
 * one section down, in the trend chart panel.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  const lastIndex = values.length - 1;

  return (
    <div style={{ width: 64, height: 28 }} className="shrink-0" aria-hidden="true">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 3, right: 3, left: 3, bottom: 3 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeOpacity={0.55}
            strokeWidth={1.5}
            isAnimationActive={false}
            // Only the last point gets a visible dot (full accent color) -
            // every earlier point renders a zero-radius (invisible) circle.
            // Cast: recharts' custom `dot` render-prop typings don't export
            // a convenient prop shape for this file to import.
            dot={((props: { cx: number; cy: number; index: number; key?: string }) => (
              <circle
                key={props.key ?? props.index}
                cx={props.cx}
                cy={props.cy}
                r={props.index === lastIndex ? 2.5 : 0}
                fill={color}
              />
            )) as never}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface KpiCardProps {
  label: string;
  value: number;
  /** Accent color — the same hue this metric's series wears in the trend/comparison charts elsewhere on the dashboard (see chartTheme.ts's METRIC_COLOR). */
  color: string;
  /** Last N days for this metric, oldest first, if a real day-bucketed series backs it — omitted (not fabricated) for grand totals with no stored history. */
  sparklineValues?: number[];
}

/**
 * A Power BI–style KPI stat card: big number first, label second, and a
 * left accent bar naming the metric by color (this app has no icon library,
 * so color is the "icon or accent color per card" the redesign brief asks
 * for). Value uses default proportional figures, not `tabular-nums` — the
 * dataviz skill reserves tabular figures for columns that must align
 * vertically (table rows, axis ticks), not a large standalone number.
 */
export function KpiCard({ label, value, color, sparklineValues }: KpiCardProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white px-4 py-3.5 flex items-center justify-between gap-3">
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="min-w-0 pl-2.5">
        <div className="text-2xl font-bold text-gray-900 leading-tight">{formatCount(value)}</div>
        <div className="text-xs text-gray-500 mt-0.5 truncate">{label}</div>
      </div>
      {sparklineValues && sparklineValues.length > 1 && <Sparkline values={sparklineValues} color={color} />}
    </div>
  );
}
