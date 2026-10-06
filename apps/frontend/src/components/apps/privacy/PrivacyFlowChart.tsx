'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useFlowData } from '@/hooks/useFlowData';
import { useSound } from '@/hooks/useSound';
import { useCanViewAdmin } from '@/store/authStore';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { AppLoader } from '@/components/ui/AppLoader';
import { useGenerative } from '@/lib/generative/useGenerative';
import { GenerativeSwap } from '@/lib/generative/GenerativeSwap';
import { summarise } from '@/lib/generative/summarise';

type ChartStyle = 'pixel' | 'clean';
type TimeRange = '1w' | '1m' | '3m' | '6m' | '1y' | 'all';
type ChartMode = 'flows' | 'net' | 'ops';

const TIME_RANGES: TimeRange[] = ['1w', '1m', '3m', '6m', '1y', 'all'];
const RANGE_LABELS: Record<TimeRange, string> = {
  '1w': '1W',
  '1m': '1M',
  '3m': '3M',
  '6m': '6M',
  '1y': '1Y',
  'all': 'ALL',
};

const MODE_LABELS: Record<ChartMode, string> = {
  flows: 'Flows',
  net: 'Net',
  ops: 'Ops',
};

function formatZec(amount: number): string {
  if (Math.abs(amount) >= 1e6) return (amount / 1e6).toFixed(1) + 'M';
  if (Math.abs(amount) >= 1e3) return (amount / 1e3).toFixed(1) + 'K';
  return amount.toFixed(0);
}

function formatOps(amount: number): string {
  if (amount >= 1e6) return (amount / 1e6).toFixed(1) + 'M';
  if (amount >= 1e3) return (amount / 1e3).toFixed(1) + 'K';
  return amount.toFixed(0);
}

export function PrivacyFlowChart() {
  const [timeRange, setTimeRange] = useState<TimeRange>('1m');
  const [mode, setMode] = useState<ChartMode>('flows');
  const [style, setStyle] = useState<ChartStyle>('pixel');
  const [showAxes, setShowAxes] = useState(false);
  const [cursorData, setCursorData] = useState<{ time: string; values: string[] } | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  const { data, loading, error, refetch } = useFlowData({ range: timeRange });
  const generative = useGenerative();

  /*
   * The primary series for whichever mode is showing, coloured to match.
   *
   * "Flows" plots shielding AND deshielding; a relief has one surface, so it
   * takes shielding - the direction the app is about - and the summary names
   * which one, rather than silently averaging two opposite quantities into a
   * number that means nothing.
   */
  const { genSeries, genAccent, genLabel } = useMemo(() => {
    const rows = data ?? [];
    if (mode === 'net') {
      const pts = rows.map((d) => d.netFlow).filter((n) => Number.isFinite(n));
      const sum = pts.reduce((a, b) => a + b, 0);
      // The same rule the line uses: green when net shielding, orange when not.
      return { genSeries: pts, genAccent: sum >= 0 ? '#00ff88' : '#ff8800', genLabel: 'Net flow' };
    }
    if (mode === 'ops') {
      return {
        genSeries: rows.map((d) => d.operations.total).filter((n) => Number.isFinite(n)),
        genAccent: '#9966ff',
        genLabel: 'Shielded operations',
      };
    }
    return {
      genSeries: rows.map((d) => d.shielding.volume).filter((n) => Number.isFinite(n)),
      genAccent: '#00ff88',
      genLabel: 'Shielding volume',
    };
  }, [data, mode]);

  const genSummary = useMemo(
    () => summarise({
      label: genLabel, points: genSeries, range: timeRange,
      unit: mode === 'ops' ? '' : ' ZEC', decimals: 0,
    }),
    [genLabel, genSeries, timeRange, mode],
  );
  const { playClick } = useSound();
  const isAdmin = useCanViewAdmin();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!data || data.length === 0 || !containerRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    // Generative mode replaces the chart; uPlot is never built.
    if (generative) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight - 60;

    // Build chart data based on mode
    const timestamps: number[] = [];
    const series1: number[] = [];
    const series2: (number | null)[] = [];

    data.forEach(d => {
      const ts = new Date(d.date).getTime() / 1000;
      timestamps.push(ts);

      if (mode === 'flows') {
        series1.push(d.shielding.volume);
        series2.push(d.deshielding.volume);
      } else if (mode === 'net') {
        series1.push(d.netFlow);
        series2.push(null);
      } else {
        series1.push(d.operations.total);
        series2.push(null);
      }
    });

    // Downsample for pixel style
    let plotTimestamps = timestamps;
    let plotSeries1 = series1;
    let plotSeries2 = series2;

    if (style === 'pixel') {
      const targetPoints = Math.min(60, timestamps.length);
      const step = Math.max(1, Math.floor(timestamps.length / targetPoints));
      plotTimestamps = [];
      plotSeries1 = [];
      plotSeries2 = [];
      for (let i = 0; i < timestamps.length; i += step) {
        plotTimestamps.push(timestamps[i]);
        plotSeries1.push(series1[i]);
        plotSeries2.push(series2[i]);
      }
    }

    const valueFormatter = mode === 'ops' ? formatOps : formatZec;

    const seriesConfig: uPlot.Series[] = [{}];

    if (mode === 'flows') {
      seriesConfig.push({
        label: 'Shielding',
        stroke: '#00ff88',
        width: style === 'pixel' ? 3 : 2,
        fill: style === 'pixel' ? 'rgba(0, 255, 136, 0.15)' : undefined,
        points: { show: false },
        paths: style === 'pixel' ? uPlot.paths.stepped!({ align: 1 }) : undefined,
      });
      seriesConfig.push({
        label: 'Deshielding',
        stroke: '#ff8800',
        width: style === 'pixel' ? 3 : 2,
        fill: style === 'pixel' ? 'rgba(255, 136, 0, 0.15)' : undefined,
        points: { show: false },
        paths: style === 'pixel' ? uPlot.paths.stepped!({ align: 1 }) : undefined,
      });
    } else if (mode === 'net') {
      // Calculate overall trend for color selection
      const netSum = series1.reduce((a, b) => a + b, 0);
      const netColor = netSum >= 0 ? '#00ff88' : '#ff8800';
      const netFill = netSum >= 0 ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 136, 0, 0.2)';

      seriesConfig.push({
        label: 'Net Flow',
        stroke: netColor,
        width: style === 'pixel' ? 3 : 2,
        fill: netFill,
        points: { show: false },
        paths: style === 'pixel' ? uPlot.paths.stepped!({ align: 1 }) : uPlot.paths.bars!({ size: [0.6, 100] }),
      });
    } else {
      seriesConfig.push({
        label: 'Operations',
        stroke: '#9966ff',
        width: style === 'pixel' ? 3 : 2,
        fill: style === 'pixel' ? 'rgba(153, 102, 255, 0.15)' : undefined,
        points: { show: false },
        paths: style === 'pixel' ? uPlot.paths.stepped!({ align: 1 }) : undefined,
      });
    }

    const opts: uPlot.Options = {
      width,
      height: Math.max(height, 120),
      cursor: { show: true, x: true, y: true },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx !== null && idx !== undefined && idx >= 0) {
              const ts = u.data[0][idx];
              if (ts) {
                const date = new Date(ts * 1000);
                const values: string[] = [];

                if (mode === 'flows') {
                  const s = u.data[1][idx];
                  const d = u.data[2]?.[idx];
                  if (s !== undefined && s !== null) values.push(`↑ ${formatZec(s as number)} ZEC`);
                  if (d !== undefined && d !== null) values.push(`↓ ${formatZec(d as number)} ZEC`);
                } else if (mode === 'net') {
                  const n = u.data[1][idx];
                  if (n !== undefined && n !== null) {
                    const prefix = (n as number) >= 0 ? '+' : '';
                    values.push(`${prefix}${formatZec(n as number)} ZEC`);
                  }
                } else {
                  const o = u.data[1][idx];
                  if (o !== undefined && o !== null) values.push(`${formatOps(o as number)} ops`);
                }

                setCursorData({
                  time: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
                  values,
                });
                setIsHovering(true);
              }
            }
          },
        ],
      },
      scales: {
        x: { time: true },
        y: { auto: true },
      },
      axes: [
        {
          show: showAxes,
          stroke: '#00ff88',
          grid: { show: false },
          ticks: { show: false },
          font: '14px var(--font-vt323)',
          values: (u, vals) => vals.map(v => {
            const d = new Date(v * 1000);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }),
        },
        {
          show: showAxes,
          stroke: '#00ff88',
          grid: { show: false },
          ticks: { show: false },
          font: '14px var(--font-vt323)',
          values: (u, vals) => vals.map(v => valueFormatter(v)),
          size: showAxes ? 55 : 0,
        },
      ],
      series: seriesConfig,
    };

    const chartData: uPlot.AlignedData = mode === 'flows'
      ? [plotTimestamps, plotSeries1, plotSeries2 as number[]]
      : [plotTimestamps, plotSeries1];

    chartRef.current = new uPlot(opts, chartData, container);

    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        const newWidth = containerRef.current.clientWidth;
        const newHeight = containerRef.current.clientHeight - 60;
        chartRef.current.setSize({ width: newWidth, height: Math.max(newHeight, 120) });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data, style, showAxes, mode, generative]);

  const handleMouseLeave = () => {
    setIsHovering(false);
    setCursorData(null);
  };

  const handleStyleChange = (newStyle: ChartStyle) => {
    playClick();
    setStyle(newStyle);
  };

  const handleModeChange = (newMode: ChartMode) => {
    playClick();
    setMode(newMode);
  };

  const handleTimeRangeCycle = () => {
    playClick();
    const currentIndex = TIME_RANGES.indexOf(timeRange);
    const nextIndex = (currentIndex + 1) % TIME_RANGES.length;
    setTimeRange(TIME_RANGES[nextIndex]);
  };

  // Summary data when not hovering
  const summaryData = useCallback(() => {
    if (!data || data.length === 0) return null;

    const totalShielding = data.reduce((sum, d) => sum + d.shielding.volume, 0);
    const totalDeshielding = data.reduce((sum, d) => sum + d.deshielding.volume, 0);
    const totalNet = totalShielding - totalDeshielding;
    const totalOps = data.reduce((sum, d) => sum + d.operations.total, 0);

    if (mode === 'flows') {
      return {
        time: `${data.length} days`,
        values: [`↑ ${formatZec(totalShielding)} ZEC`, `↓ ${formatZec(totalDeshielding)} ZEC`],
      };
    } else if (mode === 'net') {
      const prefix = totalNet >= 0 ? '+' : '';
      return {
        time: `${data.length} days`,
        values: [`${prefix}${formatZec(totalNet)} ZEC net`],
      };
    } else {
      return {
        time: `${data.length} days`,
        values: [`${formatOps(totalOps)} total ops`],
      };
    }
  }, [data, mode]);

  const displayData = isHovering && cursorData ? cursorData : summaryData();

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <h2
          style={{
            color: 'var(--accent-gold)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--font-size-title)',
            paddingBottom: '1em',
          }}
        >
        Historical Weather Flows 
      </h2>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {/* Mode buttons */}
          {(['flows', 'net', 'ops'] as ChartMode[]).map(m => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={`btn-window px-3 py-1 ${mode === m ? 'text-[var(--accent-gold)]' : 'text-[var(--text-green)]'}`}
              style={{ fontSize: 'var(--font-size-button)' }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
          <span className="text-[var(--border-window)] px-1">|</span>
          {/* Style buttons */}
          <button
            onClick={() => handleStyleChange('pixel')}
            className={`btn-window px-3 py-1 ${style === 'pixel' ? 'text-[var(--accent-gold)]' : 'text-[var(--text-green)]'}`}
            style={{ fontSize: 'var(--font-size-button)' }}
          >
            Pixel
          </button>
          <button
            onClick={() => handleStyleChange('clean')}
            className={`btn-window px-3 py-1 ${style === 'clean' ? 'text-[var(--accent-gold)]' : 'text-[var(--text-green)]'}`}
            style={{ fontSize: 'var(--font-size-button)' }}
          >
            Clean
          </button>
          <button
            onClick={() => { playClick(); setShowAxes(!showAxes); }}
            className={`btn-window px-3 py-1 ${showAxes ? 'text-[var(--accent-gold)]' : 'text-[var(--text-green)]'}`}
            style={{ fontSize: 'var(--font-size-button)' }}
          >
            Axes
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleTimeRangeCycle}
            className="btn-window px-3 py-1 text-[var(--accent-purple)]"
            style={{ fontSize: 'var(--font-size-button)' }}
          >
            {RANGE_LABELS[timeRange]}
          </button>
          {isAdmin && (
            <button
              onClick={() => { playClick(); refetch(); }}
              className="btn-window px-3 py-1 text-[var(--text-amber)]"
              style={{ fontSize: 'var(--font-size-button)' }}
            >
              ↻
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} className="flex-1 min-h-0 relative" onMouseLeave={handleMouseLeave}>
        {loading && !data ? (
          <AppLoader />
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-[var(--accent-orange)]" style={{ fontSize: 'var(--font-size-label)' }}>Flow Data Unavailable</span>
            <span className="text-[var(--text-amber)]" style={{ fontSize: 'var(--font-size-button)' }}>{error}</span>
          </div>
        ) : generative ? (
          <GenerativeSwap points={genSeries} accent={genAccent} summary={genSummary}
            fmt={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0))} />
        ) : null}
      </div>

      {/* Legend / cursor data */}
      {displayData && (
        <div className="flex justify-between items-center mt-2 flex-wrap gap-2" style={{ fontSize: 'var(--font-size-label)' }}>
          <span className="text-[var(--text-muted)]">{displayData.time}</span>
          <div className="flex gap-4">
            {displayData.values.map((v, i) => (
              <span
                key={i}
                className={
                  v.startsWith('↑') ? 'text-[var(--accent-green)]' :
                  v.startsWith('↓') ? 'text-[#ff8800]' :
                  v.startsWith('+') ? 'text-[var(--accent-green)]' :
                  v.startsWith('-') ? 'text-[#ff4444]' :
                  'text-[var(--accent-purple)]'
                }
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Mode description */}
      <div className="mt-2 text-center" style={{ fontSize: 'var(--font-size-muted)', color: 'var(--text-muted)' }}>
        {mode === 'flows' && 'Shielding (↑) vs Deshielding (↓) volume over time'}
        {mode === 'net' && 'Net pool change: positive = net shielding, negative = net deshielding'}
        {mode === 'ops' && 'Privacy operations (Sapling spends/outputs + Orchard + Ironwood actions)'}
      </div>

      <style jsx global>{`
        .uplot .u-cursor-x, .uplot .u-cursor-y { border-color: rgba(0, 255, 136, 0.6) !important; }
        .uplot { font-family: var(--font-vt323), monospace; }
        .uplot .u-legend { display: none; }
      `}</style>
    </div>
  );
}

export default PrivacyFlowChart;
