'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { AppLoader } from '@/components/ui/AppLoader';
import { cssVar, cssVarAlpha, onThemeChange } from '@/utils/cssVar';
import { ZCASH_HISTORY } from '@/data/zcashHistory';
import { copyText } from '@/utils/clipboard';
import { useGenerative } from '@/lib/generative/useGenerative';
import { GenerativeSwap } from '@/lib/generative/GenerativeSwap';
import { summarise } from '@/lib/generative/summarise';
import {
  normalisePrices, buildPosition, valueSeries, extremesOf, toUnix, priceAt,
  fmtUsd, fmtZec, CURRENCY_LABEL,
  type SeriesPoint, type PayCurrency, type Position, type ValuePoint, type Extremes,
} from './hindsight/calc';

const CURRENCIES: PayCurrency[] = ['usd', 'eth', 'btc'];

const CURRENCY_STEP: Record<PayCurrency, string> = { usd: '10', eth: '0.1', btc: '0.01' };
const CURRENCY_PLACEHOLDER: Record<PayCurrency, string> = { usd: '1000', eth: '1', btc: '0.1' };

type ChartStyle = 'clean' | 'pixel';

/** Distinct hue per marked event, reused by its button and its chart rule. */
const EVENT_COLORS = [
  '#e8b53a', '#6aa9ff', '#3ddc84', '#ff8a3d', '#c56b3e',
  '#b48cff', '#ff6b9d', '#4dd0c1', '#d4d44a',
];

type ChartMode = 'value' | 'multiple' | 'pnl';
const MODES: { id: ChartMode; label: string; hint: string }[] = [
  { id: 'value', label: 'Value', hint: 'What the position is worth, in USD' },
  { id: 'multiple', label: 'Multiple', hint: 'Times your original stake' },
  { id: 'pnl', label: 'P&L', hint: 'Profit or loss against what you put in' },
];

/**
 * Form controls carry a solid 2px border at all times so they read as inputs
 * before you touch them. Width never changes - only the colour - so focusing a
 * field can't nudge the layout.
 */
const FIELD = 'px-3 py-2 text-[15px] text-[var(--text-primary)] outline-none';

/** Label above each field. */
const FIELD_LABEL = 'text-[14px] font-medium text-[var(--text-secondary)]';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The whole view is expressible as query params, so a shared link reopens the
 * exact scenario - amount, date, chart mode and any pinned events.
 *
 * Only written when running at the standalone route: inside the desktop the URL
 * is `/`, and scribbling app state onto it would be wrong.
 */
const DEFAULT_DATE = '2017-01-01';
const DEFAULT_TIME = '04:20';
const STANDALONE_PATH = '/hindsight';
function isStandalone(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === STANDALONE_PATH;
}

interface UrlState {
  amount?: string; currency?: PayCurrency; date?: string; time?: string;
  mode?: ChartMode; style?: ChartStyle; axes?: boolean; log?: boolean; events?: number[];
}

function readUrlState(): UrlState {
  if (!isStandalone()) return {};
  const q = new URLSearchParams(window.location.search);
  const out: UrlState = {};
  const a = q.get('a'); if (a && Number.isFinite(parseFloat(a))) out.amount = a;
  const c = q.get('c'); if (c === 'usd' || c === 'eth' || c === 'btc') out.currency = c;
  const d = q.get('d'); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) out.date = d;
  const t = q.get('t'); if (t && /^\d{2}:\d{2}$/.test(t)) out.time = t;
  const m = q.get('m'); if (m === 'value' || m === 'multiple' || m === 'pnl') out.mode = m;
  const st = q.get('s'); if (st === 'clean' || st === 'pixel') out.style = st;
  if (q.has('ax')) out.axes = q.get('ax') !== '0';
  if (q.has('log')) out.log = q.get('log') === '1';
  const ev = q.get('ev');
  if (ev) out.events = ev.split(',').map(Number).filter(Number.isFinite);
  return out;
}

/**
 * Copies a link to the standalone view of exactly this scenario. Built from
 * state rather than `location.href` so it also works from inside the desktop,
 * where the URL is just `/`.
 */
function ShareView({ query }: { query: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}${STANDALONE_PATH}?${query}`;
    if (!(await copyText(url))) return;   // no confirmation for a copy that did not happen
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={share}
      className="flex items-center gap-2 px-3 py-2 text-[14px] transition-colors"
      style={{
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-window)',
        color: copied ? 'var(--accent-gold)' : 'var(--text-muted)',
        boxShadow: copied ? 'inset 0 0 0 2px var(--accent-gold)' : undefined,
      }}
      title="Copy a link to exactly this scenario"
    >
      {copied ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      )}
      {copied ? 'link copied' : 'share this'}
    </button>
  );
}

function Toggle({
  on, label, onClick, disabled, title,
}: { on: boolean; label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-pressed={on}
      className="px-3 py-1 text-[12px] transition-colors disabled:opacity-35"
      style={{
        borderRadius: 'var(--md-shape-full)',
        background: 'var(--bg-window)',
        color: on ? 'var(--accent-gold)' : 'var(--text-muted)',
        boxShadow: on ? 'inset 0 0 0 1.5px var(--accent-gold)' : undefined,
        fontWeight: on ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}

function Stat({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  const color =
    tone === 'up' ? 'var(--accent-green)' : tone === 'down' ? 'var(--accent-orange)' : 'var(--text-primary)';
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-3 py-2">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="text-[19px] leading-tight" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

/**
 * "What would that ZEC be worth now?"
 *
 * Everything is priced off recorded observations - the calculator never
 * interpolates a price that wasn't traded, and it says so when the nearest
 * observation is older than the date asked for.
 */
export function Hindsight() {
  // Read once, synchronously, so the first render already reflects a shared link.
  const [initial] = useState<UrlState>(() => readUrlState());

  const [amount, setAmount] = useState(initial.amount ?? '10');
  const [currency, setCurrency] = useState<PayCurrency>(initial.currency ?? 'usd');
  const [date, setDate] = useState(initial.date ?? DEFAULT_DATE);
  const [time, setTime] = useState(initial.time ?? DEFAULT_TIME);

  const [zec, setZec] = useState<SeriesPoint[] | null>(null);
  const [rates, setRates] = useState<Record<string, SeriesPoint[]>>({});
  const [weeklyBefore, setWeeklyBefore] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<ChartMode>(initial.mode ?? 'value');
  const [logScale, setLogScale] = useState(initial.log ?? false);
  const [style, setStyle] = useState<ChartStyle>(initial.style ?? 'clean');
  const [showAxes, setShowAxes] = useState(initial.axes ?? true);
  /** Heights of the ZCASH_HISTORY events currently pinned to the timeline. */
  const [markedEvents, setMarkedEvents] = useState<number[]>(initial.events ?? []);
  // Bumped when the theme flips so canvas colours get re-resolved.
  const [themeTick, setThemeTick] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => onThemeChange(() => setThemeTick((n) => n + 1)), []);
  useEffect(() => { amountRef.current?.focus(); amountRef.current?.select(); }, []);

  // ── ZEC history ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/prices?range=all');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const raw = json.prices ?? json.data ?? (Array.isArray(json) ? json : []);
        if (cancelled) return;
        setZec(normalisePrices(raw));
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Price history unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Pay-currency rates, fetched on demand ─────────────────────────────────
  useEffect(() => {
    if (currency === 'usd' || rates[currency]) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rates?symbol=${currency}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setRates((r) => ({ ...r, [currency]: json.prices ?? [] }));
        setWeeklyBefore((w) => ({ ...w, [currency]: json.weeklyBefore ?? null }));
      } catch {
        if (!cancelled) setRates((r) => ({ ...r, [currency]: [] }));
      }
    })();
    return () => { cancelled = true; };
  }, [currency, rates]);

  /** Query string describing the current view. */
  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    q.set('a', amount);
    q.set('c', currency);
    q.set('d', date);
    if (time) q.set('t', time);
    if (mode !== 'value') q.set('m', mode);
    if (style !== 'clean') q.set('s', style);
    if (!showAxes) q.set('ax', '0');
    if (logScale) q.set('log', '1');
    if (markedEvents.length) q.set('ev', markedEvents.join(','));
    return q.toString();
  }, [amount, currency, date, time, mode, style, showAxes, logScale, markedEvents]);

  useEffect(() => {
    if (!isStandalone()) return;
    const q = new URLSearchParams();
    q.set('a', amount);
    q.set('c', currency);
    q.set('d', date);
    if (time) q.set('t', time);
    if (mode !== 'value') q.set('m', mode);
    if (style !== 'clean') q.set('s', style);
    if (!showAxes) q.set('ax', '0');
    if (logScale) q.set('log', '1');
    if (markedEvents.length) q.set('ev', markedEvents.join(','));
    const next = `${window.location.pathname}?${q.toString()}`;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [amount, currency, date, time, mode, style, showAxes, logScale, markedEvents]);

  const buyT = useMemo(() => toUnix(date, time), [date, time]);
  const payRates = currency === 'usd' ? undefined : rates[currency];

  const result = useMemo(() => {
    if (!zec?.length) return null;
    if (currency !== 'usd' && !payRates) return null; // rates still loading
    return buildPosition({ amount: parseFloat(amount), currency, buyT, zec, payRates });
  }, [zec, amount, currency, buyT, payRates]);

  const position: Position | null = result && !('error' in result) ? result.position : null;
  const error = result && 'error' in result ? result.error : null;

  const series: ValuePoint[] = useMemo(() => {
    if (!zec || !position) return [];
    return valueSeries({
      zec, zecAmount: position.zec, buyT, amount: parseFloat(amount), currency, payRates,
    });
  }, [zec, position, buyT, amount, currency, payRates]);

  const extremes: Extremes | null = useMemo(
    () => (position && series.length ? extremesOf(series, position.usdSpent) : null),
    [series, position]
  );

  const generative = useGenerative();

  /*
   * The plotted values, through the SAME mode projection the chart uses.
   *
   * Taking the raw USD value would be simpler and wrong: in "multiple" mode the
   * line is a ratio and in "pnl" mode it is a difference, and a relief showing
   * dollars beside axis labels reading multiples is a chart that lies.
   */
  const genSeries = useMemo(() => {
    const spent = position?.usdSpent ?? 0;
    if (!series.length) return [] as number[];
    const project = (v: number) =>
      mode === 'multiple' ? (spent ? v / spent : 0) : mode === 'pnl' ? v - spent : v;
    return series.map((p) => project(p.value)).filter((n) => Number.isFinite(n));
  }, [series, position, mode]);

  const genSummary = useMemo(() => summarise({
    label: mode === 'multiple' ? 'Return multiple' : mode === 'pnl' ? 'Profit and loss' : 'Position value',
    points: genSeries,
    unit: mode === 'multiple' ? '\u00d7' : '$',
    prefix: mode !== 'multiple',
    decimals: mode === 'multiple' ? 2 : 0,
  }), [genSeries, mode]);

  /** ZCASH_HISTORY events inside the charted window, each with a stable colour. */
  const eventsInRange = useMemo(() => {
    if (!series.length) return [];
    const from = series[0].t;
    const to = series[series.length - 1].t;
    return ZCASH_HISTORY
      .map((e, i) => ({ ...e, t: toUnix(e.date), color: EVENT_COLORS[i % EVENT_COLORS.length] }))
      .filter((e) => e.t >= from && e.t <= to);
  }, [series]);

  // Drop pins that fall outside the window when the buy date moves.
  useEffect(() => {
    setMarkedEvents((prev) => prev.filter((h) => eventsInRange.some((e) => e.height === h)));
  }, [eventsInRange]);

  /** How stale the nearest recorded price is, so the readout can disclose it. */
  const staleness = useMemo(() => {
    if (!zec) return null;
    const z = priceAt(zec, buyT);
    if (!z) return null;
    const coarse = currency !== 'usd' && weeklyBefore[currency] != null && buyT < weeklyBefore[currency]!;
    return { staleDays: z.staleDays, coarse };
  }, [zec, buyT, currency, weeklyBefore]);

  // ── Chart ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !series.length || !position) return;
    // Generative mode replaces the chart; uPlot is never built.
    if (generative) return;

    const build = () => {
      chartRef.current?.destroy();

      // Canvas can't read CSS variables, so every colour is resolved first.
      const gold = cssVar('--accent-gold', '#e8b53a');
      const goldFill = cssVarAlpha('--accent-gold', 0.16, '#e8b53a');
      const blue = cssVar('--accent-blue', '#6aa9ff');
      const muted = cssVar('--text-muted', '#9b9bad');
      const grid = cssVarAlpha('--text-muted', 0.16, '#9b9bad');

      const spent = position.usdSpent;

      // "pixel" thins the series and steps between points, matching the other
      // charts in the OS; "clean" plots every observation as a smooth line.
      let plot = series;
      if (style === 'pixel') {
        const target = Math.min(80, series.length);
        const step = Math.max(1, Math.floor(series.length / target));
        plot = series.filter((_, i) => i % step === 0);
        if (plot[plot.length - 1] !== series[series.length - 1]) plot.push(series[series.length - 1]);
      }
      const xs = plot.map((p) => p.t);

      // Each mode re-expresses the same position; only the framing changes.
      const project = (v: number) =>
        mode === 'multiple' ? v / spent : mode === 'pnl' ? v - spent : v;
      const baseline = mode === 'multiple' ? 1 : mode === 'pnl' ? 0 : spent;

      const vals = plot.map((p) => project(p.value));
      const base = plot.map(() => baseline);
      const alts = plot.map((p) => (p.alt != null ? project(p.alt) : null));

      const data: (number | null)[][] = [xs, vals, base];
      const seriesOpts: uPlot.Series[] = [
        {},
        {
          label: 'ZEC position',
          stroke: gold,
          width: style === 'pixel' ? 2 : 2.2,
          // A filled area under a P&L line that crosses zero reads as wrong.
          fill: mode === 'pnl' ? undefined : goldFill,
          paths: style === 'pixel' ? uPlot.paths.stepped!({ align: 1 }) : undefined,
          points: { show: false },
        },
        {
          label: mode === 'value' ? 'Amount invested' : 'Break-even',
          stroke: muted,
          width: 1.2,
          dash: [4, 4],
          points: { show: false },
        },
      ];
      if (currency !== 'usd' && alts.some((a) => a != null)) {
        data.push(alts);
        seriesOpts.push({
          label: `Held ${CURRENCY_LABEL[currency]} instead`,
          stroke: blue,
          width: 1.8,
          dash: [6, 3],
          paths: style === 'pixel' ? uPlot.paths.stepped!({ align: 1 }) : undefined,
          points: { show: false },
        });
      }

      const fmtAxis = (v: number) => {
        if (mode === 'multiple') return `${v.toFixed(v >= 10 ? 0 : 1)}×`;
        const sign = v < 0 ? '-' : '';
        const a = Math.abs(v);
        return a >= 1000 ? `${sign}$${(a / 1000).toFixed(0)}k` : `${sign}$${a.toFixed(0)}`;
      };

      // Log only makes sense on strictly-positive series.
      const canLog = logScale && mode !== 'pnl' && vals.every((v) => v > 0);
      const pinned = eventsInRange.filter((e) => markedEvents.includes(e.height));

      chartRef.current = new uPlot(
        {
          width: container.clientWidth,
          height: Math.max(container.clientHeight - 8, 180),
          padding: [14, 14, 0, 0],
          legend: { show: false },
          cursor: { y: false, points: { show: true } },
          scales: { x: { time: true }, y: canLog ? { distr: 3 } : {} },
          axes: [
            {
              show: showAxes,
              stroke: gold,
              ticks: { show: showAxes, stroke: grid, width: 1, size: 4 },
              grid: { show: false },
              font: '12px Inter, system-ui, sans-serif',
            },
            {
              show: showAxes,
              stroke: gold,
              ticks: { show: showAxes, stroke: grid, width: 1, size: 4 },
              grid: { stroke: grid, width: 1 },
              font: '12px Inter, system-ui, sans-serif',
              values: (_u, vs) => vs.map(fmtAxis),
            },
          ],
          series: seriesOpts,
          hooks: {
            // Pinned events are drawn as vertical rules in the same colour as
            // the button that pinned them.
            draw: [
              (u) => {
                if (!pinned.length) return;
                const ctx = u.ctx;
                ctx.save();
                ctx.beginPath();
                ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
                ctx.clip();
                for (const e of pinned) {
                  const x = u.valToPos(e.t, 'x', true);
                  if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
                  ctx.strokeStyle = e.color;
                  ctx.lineWidth = 1.5 * devicePixelRatio;
                  ctx.setLineDash([5 * devicePixelRatio, 4 * devicePixelRatio]);
                  ctx.beginPath();
                  ctx.moveTo(x, u.bbox.top);
                  ctx.lineTo(x, u.bbox.top + u.bbox.height);
                  ctx.stroke();
                  ctx.setLineDash([]);
                  ctx.fillStyle = e.color;
                  ctx.beginPath();
                  ctx.arc(x, u.bbox.top + 5 * devicePixelRatio, 4 * devicePixelRatio, 0, Math.PI * 2);
                  ctx.fill();
                }
                ctx.restore();
              },
            ],
          },
        },
        data as unknown as uPlot.AlignedData,
        container
      );
    };

    const t = setTimeout(build, 50);
    const ro = new ResizeObserver(() => {
      chartRef.current?.setSize({
        width: container.clientWidth,
        height: Math.max(container.clientHeight - 8, 180),
      });
    });
    ro.observe(container);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [series, position, currency, mode, logScale, style, showAxes, themeTick, eventsInRange, markedEvents, generative]);

  const applyPreset = useCallback((iso: string) => { setDate(iso); setTime(''); }, []);

  if (loading && !zec) return <AppLoader />;
  if (loadError) {
    return <div className="p-4 text-[13px] text-[var(--accent-orange)]">Price history unavailable: {loadError}</div>;
  }

  const up = (position?.profit ?? 0) >= 0;
  const altFinal = series.length ? series[series.length - 1].alt : undefined;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {/* ── Inputs ─────────────────────────────────────────────────────── */}
      <section className="shrink-0 rounded-[var(--radius-md)] bg-[var(--bg-inset)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold text-[var(--accent-gold)]">
            Coulda, woulda - still could.
          </h2>
          <ShareView query={queryString} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>I put in</span>
            <div className="flex items-center gap-1">
              <input
                ref={amountRef}
                data-field
                type="number"
                min="0"
                step={CURRENCY_STEP[currency]}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={CURRENCY_PLACEHOLDER[currency]}
                className={`w-32 ${FIELD}`}
              />
              <div className="flex overflow-hidden rounded-[var(--radius-sm)] bg-[var(--bg-inset)]">
                {CURRENCIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCurrency(c)}
                    className="px-3 py-2 text-[14px] transition-colors"
                    style={{
                      background: currency === c ? 'var(--accent-gold)' : 'transparent',
                      color: currency === c ? 'var(--bg-desktop)' : 'var(--text-muted)',
                      fontWeight: currency === c ? 700 : 500,
                    }}
                  >
                    {CURRENCY_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>on</span>
            <input
              data-field
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
              className={FIELD}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>time <span className="text-[var(--text-muted)]">(optional)</span></span>
            <input
              data-field
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={FIELD}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">jump to</span>
          {ZCASH_HISTORY.filter((e) => e.tag === 'upgrade' || e.tag === 'halving')
            .slice(-4)
            .map((e) => (
              <button
                key={e.height}
                onClick={() => applyPreset(e.date)}
                className="px-2.5 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-gold)]"
                style={{ background: 'var(--bg-window)', borderRadius: 'var(--md-shape-full)' }}
                title={`${e.title} - ${e.date}`}
              >
                {e.title.replace(/ Activation.*| \/ .*/, '')}
              </button>
            ))}
          {[
            { label: '1 year ago', d: new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10) },
            { label: 'launch', d: '2016-10-28' },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.d)}
              className="px-2.5 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-gold)]"
              style={{ background: 'var(--bg-window)', borderRadius: 'var(--md-shape-full)' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="shrink-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] text-[var(--accent-orange)]">
          {error}
        </div>
      )}

      {position && (
        <>
          {/* ── Headline ──────────────────────────────────────────────── */}
          <section className="shrink-0 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat
              label="Worth today"
              value={fmtUsd(position.valueNow)}
              sub={`from ${fmtUsd(position.usdSpent)}`}
              tone={up ? 'up' : 'down'}
            />
            <Stat
              label={up ? 'Profit' : 'Loss'}
              value={`${up ? '+' : ''}${fmtUsd(position.profit)}`}
              sub={`${position.roiPct >= 0 ? '+' : ''}${position.roiPct.toFixed(1)}%`}
              tone={up ? 'up' : 'down'}
            />
            <Stat
              label="Multiple"
              value={`${position.multiple.toFixed(2)}×`}
              sub={position.cagrPct != null ? `${position.cagrPct.toFixed(1)}% a year` : 'under a month held'}
              tone={position.multiple >= 1 ? 'up' : 'down'}
            />
            <Stat
              label="ZEC acquired"
              value={fmtZec(position.zec)}
              sub={`at ${fmtUsd(position.zecPriceThen)} each`}
            />
          </section>

          {/* ── Chart ─────────────────────────────────────────────────── */}
          {/*
            * `min-h-0` and `overflow-hidden` are what stop the chart covering
            * the cards below it.
            *
            * A flex item defaults to `min-height: auto`, which refuses to
            * shrink below its content - so in a short window this section kept
            * its full height, overflowed its box, and painted straight over the
            * next section instead of giving way. The 240px floor stays as a
            * floor for the page scroll, not as a size it must occupy.
            */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-md)] bg-[var(--bg-inset)] p-3"
            style={{ minHeight: 'min(240px, 42vh)' }}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-[var(--md-shape-full)] bg-[var(--bg-window)] p-0.5">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    title={m.hint}
                    className="px-3 py-1 text-[12px] transition-colors"
                    style={{
                      borderRadius: 'var(--md-shape-full)',
                      background: mode === m.id ? 'var(--accent-gold)' : 'transparent',
                      color: mode === m.id ? 'var(--bg-desktop)' : 'var(--text-muted)',
                      fontWeight: mode === m.id ? 700 : 500,
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="flex overflow-hidden rounded-[var(--md-shape-full)] bg-[var(--bg-window)] p-0.5">
                {(['clean', 'pixel'] as ChartStyle[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStyle(st)}
                    className="px-3 py-1 text-[12px] transition-colors"
                    style={{
                      borderRadius: 'var(--md-shape-full)',
                      background: style === st ? 'var(--accent-gold)' : 'transparent',
                      color: style === st ? 'var(--bg-desktop)' : 'var(--text-muted)',
                      fontWeight: style === st ? 700 : 500,
                    }}
                  >
                    {st}
                  </button>
                ))}
              </div>

              <Toggle on={showAxes} onClick={() => setShowAxes((v) => !v)} label="axes" />
              <Toggle
                on={logScale && mode !== 'pnl'}
                disabled={mode === 'pnl'}
                onClick={() => setLogScale((v) => !v)}
                label="log"
                title={mode === 'pnl' ? 'Log scale needs positive values' : 'Log scale'}
              />
            </div>

            {/* Historic markers */}
            {eventsInRange.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-[var(--text-muted)]">mark</span>
                {eventsInRange.map((e) => {
                  const on = markedEvents.includes(e.height);
                  return (
                    <button
                      key={e.height}
                      onClick={() =>
                        setMarkedEvents((prev) =>
                          on ? prev.filter((h) => h !== e.height) : [...prev, e.height]
                        )
                      }
                      title={`${e.title} - ${e.date}`}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] transition-colors"
                      style={{
                        borderRadius: 'var(--md-shape-full)',
                        background: on ? e.color : 'var(--bg-window)',
                        color: on ? 'var(--bg-desktop)' : 'var(--text-muted)',
                        fontWeight: on ? 700 : 500,
                        boxShadow: on ? undefined : `inset 0 0 0 1.5px ${e.color}55`,
                      }}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: on ? 'var(--bg-desktop)' : e.color }}
                      />
                      {e.title.replace(/ Activation.*| \/ .*/, '')}
                    </button>
                  );
                })}
                {markedEvents.length > 0 && (
                  <button
                    onClick={() => setMarkedEvents([])}
                    className="px-2 py-1 text-[11px] text-[var(--text-muted)] underline decoration-dotted hover:text-[var(--accent-gold)]"
                  >
                    clear
                  </button>
                )}
              </div>
            )}

            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="flex items-center gap-1.5" style={{ color: 'var(--accent-gold)' }}>
                <span className="inline-block h-0.5 w-4" style={{ background: 'var(--accent-gold)' }} />
                ZEC position
              </span>
              <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                <span className="inline-block h-0.5 w-4" style={{ background: 'var(--text-muted)' }} />
                {mode === 'value' ? 'amount invested' : 'break-even'}
              </span>
              {currency !== 'usd' && altFinal != null && (
                <span className="flex items-center gap-1.5" style={{ color: 'var(--accent-blue)' }}>
                  <span className="inline-block h-0.5 w-4" style={{ background: 'var(--accent-blue)' }} />
                  held {CURRENCY_LABEL[currency]} instead
                </span>
              )}
            </div>
            <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
              {generative && (
                <GenerativeSwap
                  points={genSeries}
                  accent="--accent-gold"
                  summary={genSummary}
                  fmt={(v) => (mode === 'multiple'
                    ? `${v.toFixed(v >= 10 ? 0 : 1)}\u00d7`
                    : `${v < 0 ? '-' : ''}$${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(0)}k` : Math.abs(v).toFixed(0)}`)}
                />
              )}
            </div>
          </section>

          {/* ── Journey ───────────────────────────────────────────────── */}
          {extremes?.peak && extremes.trough && (
            <section className="shrink-0 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat
                label="Best it ever was"
                value={fmtUsd(extremes.peak.value)}
                sub={new Date(extremes.peak.t * 1000).toLocaleDateString()}
              />
              <Stat
                label="Worst it ever was"
                value={fmtUsd(extremes.trough.value)}
                sub={new Date(extremes.trough.t * 1000).toLocaleDateString()}
              />
              <Stat
                label="Deepest drop"
                value={`−${extremes.maxDrawdownPct.toFixed(1)}%`}
                sub="peak to trough"
                tone="down"
              />
              <Stat
                label="Time in profit"
                value={`${extremes.daysInProfitPct.toFixed(0)}%`}
                sub={`of ${position.heldDays.toLocaleString()} days held`}
              />
            </section>
          )}

          {/* ── Comparison + caveats ──────────────────────────────────── */}
          <section className="shrink-0 space-y-2 pb-1">
            {currency !== 'usd' && altFinal != null && (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-4 py-3 text-[15px] leading-relaxed">
                <span className="text-[var(--text-muted)]">
                  Holding the {CURRENCY_LABEL[currency]} instead would be worth{' '}
                </span>
                <span className="font-semibold text-[var(--accent-blue)]">{fmtUsd(altFinal)}</span>
                <span className="text-[var(--text-muted)]"> today - buying ZEC came out </span>
                <span
                  className="font-semibold"
                  style={{ color: position.valueNow >= altFinal ? 'var(--accent-green)' : 'var(--accent-orange)' }}
                >
                  {position.valueNow >= altFinal ? 'ahead' : 'behind'} by {fmtUsd(Math.abs(position.valueNow - altFinal))}
                </span>
                <span className="text-[var(--text-muted)]">.</span>
              </div>
            )}

            <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-4 py-3">
              <div className="mb-2 text-[13px] font-semibold tracking-wide text-[var(--accent-gold)]">
                How these numbers are made
              </div>
              <ul className="space-y-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
                <li className="flex gap-2">
                  <span aria-hidden style={{ color: 'var(--accent-gold)' }}>•</span>
                  <span>
                    <span className="text-[var(--text-primary)]">ZEC prices</span> come from our own
                    node&apos;s full daily history - every day since launch in October 2016.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden style={{ color: 'var(--accent-gold)' }}>•</span>
                  <span>
                    <span className="text-[var(--text-primary)]">ETH and BTC prices</span> come from
                    Kraken&apos;s public feed - a single exchange, not a cross-venue median.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden style={{ color: 'var(--accent-gold)' }}>•</span>
                  <span>
                    <span className="text-[var(--text-primary)]">Nothing is interpolated.</span> A
                    price series is a record of trades, so a date picks the last close at or before
                    it rather than a value invented in between.
                    {staleness && staleness.staleDays > 0 && (
                      <> The nearest ZEC close is {staleness.staleDays} day
                        {staleness.staleDays === 1 ? '' : 's'} before your date.</>
                    )}
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden style={{ color: staleness?.coarse ? 'var(--accent-orange)' : 'var(--accent-gold)' }}>•</span>
                  <span>
                    <span className={staleness?.coarse ? 'text-[var(--accent-orange)]' : 'text-[var(--text-primary)]'}>
                      ETH/BTC before August 2024 are weekly closes.
                    </span>{' '}
                    Measured against the daily era that is typically within ~3%, but can be off by
                    as much as ~25% in a volatile week - and that error scales the whole result.
                    {staleness?.coarse && ' Your chosen date falls in this range.'}
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden style={{ color: 'var(--accent-gold)' }}>•</span>
                  <span>
                    <span className="text-[var(--text-primary)]">Times are approximate.</span>{' '}
                    Everything is a daily close, so the optional time field cannot give intraday
                    precision.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden style={{ color: 'var(--accent-gold)' }}>•</span>
                  <span>
                    <span className="text-[var(--text-primary)]">Fees, spreads and taxes are not
                    modelled.</span> Treat this as the shape of the outcome, not a statement of
                    account.
                  </span>
                </li>
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default Hindsight;
