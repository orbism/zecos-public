// Central pool definitions - the single source of truth for shielded-vs-supply math.
//
// CRITICAL: `lockbox` is the NU6 deferred dev-fund, NOT a shielded pool. It counts
// toward TOTAL SUPPLY but must be EXCLUDED from every shielded calculation
// (totalShielded, shieldedPct, ShieldedChart, TotalShielded, ShieldedPercent, ...).
// Use sumShielded()/sumSupply()/shieldedPct() below rather than hand-rolling sums so
// the rule can't be violated by accident when new pools are added.

// Shielded pools, ordered oldest → newest. Ironwood joined at NU7 / Zebra 6.2.2.
export const SHIELDED_POOLS = ['sprout', 'sapling', 'orchard', 'ironwood'] as const;
export type ShieldedPool = (typeof SHIELDED_POOLS)[number];

// Non-shielded components that still count toward total supply.
export const SUPPLY_ONLY = ['transparent', 'lockbox'] as const;
export type SupplyOnly = (typeof SUPPLY_ONLY)[number];

export type PoolKey = ShieldedPool | SupplyOnly;

export const POOL_LABELS: Record<PoolKey, string> = {
  transparent: 'Transparent',
  sprout: 'Sprout',
  sapling: 'Sapling',
  orchard: 'Orchard',
  ironwood: 'Ironwood',
  lockbox: 'Lockbox',
};

export const POOL_COLORS: Record<PoolKey, string> = {
  transparent: '#8899aa',
  sprout: '#9966ff',
  sapling: '#f4b728',
  orchard: '#00cc66',
  ironwood: '#c56b3e', // warm ironwood-brown, distinct from the other pool hues
  lockbox: '#5a6b7a',
};

// Accepts any object that carries some subset of pool balances (ChainData.pools,
// PoolsHistoryData, raw API objects). Extra fields like `timestamp` are ignored.
type PoolMap = Partial<Record<PoolKey, number>> | null | undefined;

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

/** Sum of the shielded pools only. Never includes transparent or lockbox. */
export function sumShielded(pools: PoolMap): number {
  if (!pools) return 0;
  return SHIELDED_POOLS.reduce((s, k) => s + num(pools[k]), 0);
}

/** Total supply = shielded pools + transparent + lockbox. */
export function sumSupply(pools: PoolMap): number {
  if (!pools) return 0;
  return sumShielded(pools) + SUPPLY_ONLY.reduce((s, k) => s + num(pools[k]), 0);
}

/** Shielded % of total supply, with lockbox correctly excluded from the numerator. */
export function shieldedPct(pools: PoolMap): number {
  const supply = sumSupply(pools);
  return supply > 0 ? (sumShielded(pools) / supply) * 100 : 0;
}
