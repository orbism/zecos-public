import type { PoolsHistoryData } from '@/hooks/useZecData';
import { SHIELDED_POOLS, type ShieldedPool } from '@/config/pools';

export function fmtZec(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export function fmtPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(digits)}%`;
}

/** Ordered shielded pools with their value at a single history point. */
export function poolValues(p: PoolsHistoryData): Record<ShieldedPool, number> {
  return {
    sprout: p.sprout ?? 0,
    sapling: p.sapling ?? 0,
    orchard: p.orchard ?? 0,
    ironwood: p.ironwood ?? 0,
  };
}

export function shieldedTotal(p: PoolsHistoryData): number {
  return SHIELDED_POOLS.reduce((s, k) => s + (poolValues(p)[k] || 0), 0);
}

/**
 * Ordinary least-squares fit of y over x. Returns slope/intercept in the units
 * given. Used for adoption-velocity projection - a straight-line extrapolation,
 * explicitly labelled as such in the UI (it is not a forecast model).
 */
export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i];
    sxy += xs[i] * ys[i];
    sxx += xs[i] * xs[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Consecutive-point deltas for one pool across a history series. */
export function poolDeltas(history: PoolsHistoryData[], pool: ShieldedPool): { t: number; delta: number }[] {
  const out: { t: number; delta: number }[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = poolValues(history[i - 1])[pool];
    const cur = poolValues(history[i])[pool];
    out.push({ t: Number(history[i].timestamp), delta: cur - prev });
  }
  return out;
}
