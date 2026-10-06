'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { usePoolsHistory } from '@/hooks/useZecData';
import { POOL_COLORS } from '@/config/pools';
import { AppLoader } from '@/components/ui/AppLoader';
import { fmtCompact, linearFit, poolValues, shieldedTotal } from './shared';
import { useGenerative } from '@/lib/generative/useGenerative';
import { GenerativeSwap } from '@/lib/generative/GenerativeSwap';
import { summarise } from '@/lib/generative/summarise';

const RANGES = ['1d', '3d', '7d', '1m', '3m', '1y', 'all'] as const;
type Range = (typeof RANGES)[number];
const HOURLY = new Set<Range>(['1d', '3d', '7d']);

const DAY_MS = 86_400_000;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-window)] bg-[var(--bg-inset)] px-3 py-2">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="text-[17px] text-[var(--text-primary)]">{value}</div>
      {hint ? <div className="text-[11px] text-[var(--text-muted)]">{hint}</div> : null}
    </div>
  );
}

export function Adoption() {
  const [range, setRange] = useState<Range>('7d');
  const { data: history, loading, error } = usePoolsHistory(range);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  // Ironwood's share of all shielded value, over time.
  const series = useMemo(() => {
    if (!history?.length) return null;
    const xs: number[] = [];
    const share: number[] = [];
    const iron: number[] = [];
    const orch: number[] = [];
    for (const p of history) {
      const total = shieldedTotal(p);
      const v = poolValues(p);
      xs.push(Number(p.timestamp) / 1000);
      share.push(total > 0 ? (v.ironwood / total) * 100 : 0);
      iron.push(v.ironwood);
      orch.push(v.orchard);
    }
    return { xs, share, iron, orch };
  }, [history]);

  const generative = useGenerative();
  const genShare = series?.share ?? [];
  const genSummary = useMemo(
    () => summarise({ label: 'Ironwood share of shielded value', points: genShare, unit: '%', decimals: 1 }),
    [genShare],
  );

  // Straight-line extrapolation over the trailing window. Explicitly a
  // trend line, not a forecast - stated as such in the UI.
  const projection = useMemo(() => {
    if (!history?.length || history.length < 4) return null;
    const tail = history.slice(-Math.min(HOURLY.has(range) ? 168 : 90, history.length));
    const t0 = Number(tail[0].timestamp);
    const days = tail.map((p) => (Number(p.timestamp) - t0) / DAY_MS);
    const ironVals = tail.map((p) => poolValues(p).ironwood);
    const orchVals = tail.map((p) => poolValues(p).orchard);

    const ironFit = linearFit(days, ironVals);
    const orchFit = linearFit(days, orchVals);

    const last = history[history.length - 1];
    const lastIron = poolValues(last).ironwood;
    const lastOrch = poolValues(last).orchard;

    // Convergence: lastIron + si*d == lastOrch + so*d
    const rel = ironFit.slope - orchFit.slope;
    const gap = lastOrch - lastIron;
    const daysToParity = rel > 0 && gap > 0 ? gap / rel : null;

    return {
      perDay: ironFit.slope,
      orchPerDay: orchFit.slope,
      daysToParity,
      windowDays: Math.round(days[days.length - 1]),
    };
  }, [history, range]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !series) return;
    // Generative mode replaces the chart; uPlot is never built.
    if (generative) return;

    const build = () => {
      chartRef.current?.destroy();
      const opts: uPlot.Options = {
        width: container.clientWidth,
        height: Math.max(container.clientHeight - 8, 160),
        padding: [12, 12, 0, 0],
        legend: { show: false },
        cursor: { y: false },
        scales: { x: { time: true } },
        axes: [
          {
            stroke: 'var(--text-muted)',
            font: '12px var(--font-primary)',
            grid: { show: false },
            ticks: { show: false },
          },
          {
            stroke: 'var(--text-muted)',
            font: '12px var(--font-primary)',
            grid: { stroke: 'rgba(255,255,255,0.06)', width: 1 },
            ticks: { show: false },
            values: (_u, vals) => vals.map((v) => `${v.toFixed(0)}%`),
          },
        ],
        series: [
          {},
          {
            label: 'Ironwood share',
            stroke: POOL_COLORS.ironwood,
            width: 2,
            fill: 'rgba(197,107,62,0.14)',
          },
        ],
      };
      chartRef.current = new uPlot(opts, [series.xs, series.share] as unknown as uPlot.AlignedData, container);
    };

    const t = setTimeout(build, 50);
    const ro = new ResizeObserver(() => {
      if (chartRef.current) {
        chartRef.current.setSize({
          width: container.clientWidth,
          height: Math.max(container.clientHeight - 8, 160),
        });
      }
    });
    ro.observe(container);

    return () => {
      clearTimeout(t);
      ro.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [series, generative]);

  if (error) {
    return <div className="p-4 text-[13px] text-[var(--accent-orange)]">Adoption data unavailable: {error}</div>;
  }
  if (loading && !history) return <AppLoader />;

  const latestShare = series?.share[series.share.length - 1] ?? 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-[var(--radius-sm)] border px-2.5 py-1 text-[12px] transition-colors ${
              range === r
                ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]'
                : 'border-[var(--border-light)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {r.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Ironwood share of shielded" value={`${latestShare.toFixed(2)}%`} />
        <Stat
          label="Ironwood net / day"
          value={projection ? `${projection.perDay >= 0 ? '+' : ''}${fmtCompact(projection.perDay)}` : '-'}
          hint={projection ? `trailing ${projection.windowDays}d` : undefined}
        />
        <Stat
          label="Orchard net / day"
          value={projection ? `${projection.orchPerDay >= 0 ? '+' : ''}${fmtCompact(projection.orchPerDay)}` : '-'}
          hint={projection ? `trailing ${projection.windowDays}d` : undefined}
        />
        <Stat
          label="Linear parity w/ Orchard"
          value={
            projection?.daysToParity == null
              ? 'not converging'
              : `~${Math.round(projection.daysToParity).toLocaleString()}d`
          }
          hint="trend line, not a forecast"
        />
      </div>

      <div className="min-h-[200px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-window)] bg-[var(--bg-inset)] p-2">
        <div ref={containerRef} className="h-full w-full">
          {generative && (
            // Ironwood copper, matching the share line.
            <GenerativeSwap points={genShare} accent={POOL_COLORS.ironwood} summary={genSummary}
              fmt={(v) => `${v.toFixed(1)}%`} />
          )}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
        Share is Ironwood ÷ (Sprout + Sapling + Orchard + Ironwood). Lockbox and transparent value
        are excluded - they are not shielded. Parity is a straight-line extrapolation of the
        trailing window and will move as the trend does.
      </p>
    </div>
  );
}

export default Adoption;
