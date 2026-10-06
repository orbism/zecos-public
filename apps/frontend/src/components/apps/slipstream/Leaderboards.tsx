'use client';

import { useMemo, useState } from 'react';
import { useChainData, useMinerLeaderboard, usePoolsHistory } from '@/hooks/useZecData';
import {
  POOL_COLORS,
  POOL_LABELS,
  SHIELDED_POOLS,
  sumShielded,
  sumSupply,
  type PoolKey,
} from '@/config/pools';
import { AppLoader } from '@/components/ui/AppLoader';
import { fmtCompact, fmtPct, poolDeltas, poolValues } from './shared';

/**
 * Inflow-size bands for Ironwood. Derived from hourly balance deltas - this is
 * aggregate movement, NOT per-address activity. Surfaced as "inferred" in the UI.
 */
const COHORTS = [
  { key: 'whale', label: 'Whale', min: 10_000, color: 'var(--accent-gold)' },
  { key: 'mid', label: 'Mid', min: 1_000, color: 'var(--accent-blue)' },
  { key: 'retail', label: 'Retail', min: 0, color: 'var(--text-muted)' },
] as const;

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] p-4">
      <h3 className="text-[13px] font-semibold tracking-wide text-[var(--accent-gold)]">{title}</h3>
      {note ? <p className="mt-1 mb-3 text-[11px] leading-relaxed text-[var(--text-muted)]">{note}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

/** Single stacked bar showing every pool's share of one whole. */
function StackedShare({
  parts,
}: {
  parts: { key: string; label: string; value: number; color: string }[];
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-7 overflow-hidden rounded-[var(--md-shape-full)]">
        {parts.map((p) => {
          const pct = (p.value / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={p.key}
              title={`${p.label} - ${fmtCompact(p.value)} ZEC (${pct.toFixed(1)}%)`}
              className="h-full transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%`, background: p.color }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            {p.label}
            <span className="text-[var(--text-primary)]">{((p.value / total) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Concentric ring chart - pool share of the shielded set. */
function ShareRings({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="h-[150px] w-[150px] shrink-0" role="img" aria-label="Pool share">
      <g transform="translate(70,70) rotate(-90)">
        <circle r={R} fill="none" stroke="var(--bg-window)" strokeWidth={18} />
        {parts.map((p) => {
          const frac = p.value / total;
          const dash = C * frac;
          const el = (
            <circle
              key={p.key}
              r={R}
              fill="none"
              stroke={p.color}
              strokeWidth={18}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              style={{ transition: 'stroke-dasharray 700ms ease, stroke-dashoffset 700ms ease' }}
            >
              <title>{`${p.label} - ${(frac * 100).toFixed(1)}%`}</title>
            </circle>
          );
          offset += dash;
          return el;
        })}
      </g>
    </svg>
  );
}

/** Tiny inline trend line. */
function Spark({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((v, i) => `${(i / (points.length - 1)) * 100},${28 - ((v - min) / span) * 26}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-24 shrink-0" aria-hidden>
      <polyline points={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function RankRow({
  rank, label, value, sub, pct, color,
}: {
  rank: number; label: string; value: string; sub?: string; pct: number; color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3 text-[12px]">
          <span className="truncate text-[var(--text-primary)]">{label}</span>
          <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
            {value}
            {sub ? <span className="ml-2 text-[var(--text-secondary)]">{sub}</span> : null}
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-[var(--md-shape-full)] bg-[var(--bg-window)]">
          <div
            className="h-full rounded-[var(--md-shape-full)] transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
          />
        </div>
      </div>
    </div>
  );
}

export function Leaderboards() {
  const { data: chain, loading: chainLoading } = useChainData();
  const [minerRange, setMinerRange] = useState('30d');
  const { data: miners, loading: minersLoading } = useMinerLeaderboard(minerRange);
  const { data: history } = usePoolsHistory('7d');

  const shieldedParts = useMemo(() => {
    if (!chain?.pools) return [];
    const pools = chain.pools;
    return SHIELDED_POOLS.map((k) => ({
      key: k,
      label: POOL_LABELS[k],
      value: pools[k] ?? 0,
      color: POOL_COLORS[k],
    }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [chain]);

  const supplyParts = useMemo(() => {
    if (!chain?.pools) return [];
    const pools = chain.pools;
    const keys: PoolKey[] = [...SHIELDED_POOLS, 'transparent', 'lockbox'];
    return keys
      .map((k) => ({ key: k, label: POOL_LABELS[k], value: pools[k] ?? 0, color: POOL_COLORS[k] }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [chain]);

  // Per-pool trend over the last 7 days, for the sparklines.
  const trends = useMemo(() => {
    const out: Record<string, number[]> = {};
    if (!history?.length) return out;
    for (const k of SHIELDED_POOLS) out[k] = history.map((h) => poolValues(h)[k]);
    return out;
  }, [history]);

  const cohorts = useMemo(() => {
    if (!history?.length) return null;
    const inflows = poolDeltas(history, 'ironwood').filter((d) => d.delta > 0);
    if (!inflows.length) return null;
    const buckets = COHORTS.map((c) => ({ ...c, volume: 0, count: 0 }));
    for (const { delta } of inflows) {
      const b = buckets.find((x) => delta >= x.min)!;
      b.volume += delta;
      b.count += 1;
    }
    return { buckets, total: buckets.reduce((s, b) => s + b.volume, 0) };
  }, [history]);

  if (chainLoading && !chain) return <AppLoader />;

  const shieldedTotal = chain?.pools ? sumShielded(chain.pools) : 0;
  const supplyTotal = chain?.pools ? sumSupply(chain.pools) : 0;
  const maxPool = shieldedParts.length ? shieldedParts[0].value : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-4 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          <span className="text-[var(--accent-gold)]">Shielded holders cannot be enumerated.</span>{' '}
          That is the point of a shielded pool. Nothing here claims to identify who holds what -
          these are pool-level balances, transparent-side mining shares, and size-banded aggregate
          flows.
        </p>
      </div>

      <Section
        title="Shielded pool share"
        note="Live balances from /api/chain. Ring and bar show the same split; the rows add a 7-day trend per pool."
      >
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative">
            <ShareRings parts={shieldedParts} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[15px] text-[var(--text-primary)]">{fmtCompact(shieldedTotal)}</span>
              <span className="text-[10px] text-[var(--text-muted)]">ZEC shielded</span>
            </div>
          </div>

          <div className="min-w-[240px] flex-1 space-y-3">
            {shieldedParts.map((p, i) => (
              <div key={p.key} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <RankRow
                    rank={i + 1}
                    label={p.label}
                    value={`${fmtCompact(p.value)} ZEC`}
                    sub={fmtPct((p.value / (shieldedTotal || 1)) * 100, 1)}
                    pct={maxPool > 0 ? (p.value / maxPool) * 100 : 0}
                    color={p.color}
                  />
                </div>
                <Spark points={trends[p.key] ?? []} color={p.color} />
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        title="Share of total supply"
        note="Transparent value and the NU6 lockbox included here - the lockbox counts toward supply but is never shielded."
      >
        <StackedShare parts={supplyParts} />
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          {fmtCompact(shieldedTotal)} of {fmtCompact(supplyTotal)} ZEC is shielded -{' '}
          <span className="text-[var(--text-primary)]">
            {fmtPct((shieldedTotal / (supplyTotal || 1)) * 100, 2)}
          </span>
        </p>
      </Section>

      <Section
        title="Miner leaderboard"
        note="Block production share from /api/miners. Coinbase output is transparent, so this is directly observable."
      >
        <div className="mb-3 flex gap-2">
          {['7d', '30d', '90d'].map((r) => (
            <button
              key={r}
              onClick={() => setMinerRange(r)}
              className={`px-3 py-1 text-[11px] transition-colors ${
                minerRange === r
                  ? 'bg-[var(--accent-gold)] text-[var(--bg-desktop)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              style={{ borderRadius: 'var(--md-shape-full)' }}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
        {minersLoading && !miners ? (
          <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">loading…</div>
        ) : !miners?.length ? (
          <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">No miner data.</div>
        ) : (
          <>
            <div className="mb-4">
              <StackedShare
                parts={miners.slice(0, 8).map((m, i) => ({
                  key: m.address,
                  label: m.tag || `${m.address.slice(0, 6)}…`,
                  value: m.blockCount,
                  color: `hsl(${(i * 47) % 360}, 62%, 55%)`,
                }))}
              />
            </div>
            <div className="space-y-3">
              {miners.slice(0, 10).map((m, i) => (
                <RankRow
                  key={m.address}
                  rank={i + 1}
                  label={m.tag || `${m.address.slice(0, 10)}…${m.address.slice(-6)}`}
                  value={`${m.blockCount.toLocaleString()} blk`}
                  sub={fmtPct(m.percentage, 1)}
                  pct={m.percentage}
                  color={`hsl(${(i * 47) % 360}, 62%, 55%)`}
                />
              ))}
            </div>
          </>
        )}
      </Section>

      <Section
        title="Ironwood inflow bands"
        note="INFERRED. Hourly net-balance increases over the last 7 days, grouped by size. A band is not a wallet - a single large move and many coordinated small ones are indistinguishable here."
      >
        {!cohorts ? (
          <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">
            No Ironwood inflow in the last 7 days.
          </div>
        ) : (
          <>
            <div className="mb-4">
              <StackedShare
                parts={cohorts.buckets.map((b) => ({
                  key: b.key,
                  label: b.label,
                  value: b.volume,
                  color: b.color,
                }))}
              />
            </div>
            <div className="space-y-3">
              {cohorts.buckets.map((b, i) => (
                <RankRow
                  key={b.key}
                  rank={i + 1}
                  label={`${b.label} - ≥ ${fmtCompact(b.min)} ZEC/hr`}
                  value={`${fmtCompact(b.volume)} ZEC`}
                  sub={`${b.count} hr`}
                  pct={cohorts.total > 0 ? (b.volume / cohorts.total) * 100 : 0}
                  color={b.color}
                />
              ))}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

export default Leaderboards;
