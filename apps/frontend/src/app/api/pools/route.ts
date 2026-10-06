import { NextRequest, NextResponse } from 'next/server';
import { API_CONFIG, getApiHeaders } from '@/config/api';

const VALID_RANGES = ['1d', '3d', '7d', '1m', '3m', '6m', '1y', '2y', 'all'];
const HOURLY_RANGES = ['1d', '3d', '7d'];

// Number of trailing days to keep for each daily range (/api/daily returns the
// full history regardless of range, so we slice here). 'all' keeps everything.
const RANGE_DAYS: Record<string, number> = {
  '1m': 31, '3m': 92, '6m': 183, '1y': 366, '2y': 731,
};
// Hours to request for each hourly range.
const RANGE_HOURS: Record<string, number> = { '1d': 24, '3d': 72, '7d': 168 };

// In-memory cache to prevent hammering APIs on concurrent requests
const poolsCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute cache
const pendingRequests = new Map<string, Promise<unknown>>();

function getCachedData(range: string): unknown | null {
  const cached = poolsCache.get(range);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

// Last-known data regardless of TTL - used to ride out a transient upstream outage.
function getStaleData(range: string): unknown | null {
  return poolsCache.get(range)?.data ?? null;
}

function setCachedData(range: string, data: unknown): void {
  poolsCache.set(range, { data, timestamp: Date.now() });
}

// Build the correct backend flows URL for each range
function getFlowsUrl(range: string): string {
  if (range === '7d') {
    return `${API_CONFIG.baseUrl}/api/flows/hourly?hours=168`;
  }
  return `${API_CONFIG.baseUrl}/api/flows?range=${range}`;
}

// Extract pool value - handles both direct numbers and {total, delta} objects
function getPoolValue(val: number | { total: number; delta?: number } | undefined): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && 'total' in val) return val.total;
  return 0;
}

interface PoolPoint {
  timestamp: string;
  sprout: number;
  sapling: number;
  orchard: number;
  ironwood: number;
  transparent: number;
}

// PRIMARY (short ranges): /api/flows/hourly - timestamped, per-pool balances incl. ironwood.
async function getPoolHistoryHourly(range: string): Promise<PoolPoint[]> {
  const hours = RANGE_HOURS[range] ?? 168;
  const res = await fetch(`${API_CONFIG.baseUrl}/api/flows/hourly?hours=${hours}`, {
    headers: getApiHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch hourly flows: ${res.status}`);
  const json = await res.json();
  return (json.data ?? [])
    .filter((e: { pools?: object }) => e.pools)
    .map((e: { timestamp: string; pools: Record<string, number | { total: number }> }) => ({
      timestamp: e.timestamp,
      sprout: getPoolValue(e.pools.sprout),
      sapling: getPoolValue(e.pools.sapling),
      orchard: getPoolValue(e.pools.orchard),
      ironwood: getPoolValue(e.pools.ironwood),
      transparent: getPoolValue(e.pools.transparent),
    }));
}

// PRIMARY (daily ranges): /api/daily - end-of-day per-pool balances incl. ironwood,
// dated. The endpoint ignores `range` and returns full history, so we slice here.
async function getPoolHistoryDaily(range: string): Promise<PoolPoint[]> {
  const res = await fetch(`${API_CONFIG.baseUrl}/api/daily`, {
    headers: getApiHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch daily series: ${res.status}`);
  const json = await res.json();
  const mapped: PoolPoint[] = (json.series ?? [])
    .filter((e: { eod?: object; date?: string }) => e.eod && e.date)
    .map((e: { date: string; eod: Record<string, number> }) => ({
      timestamp: e.date,
      sprout: e.eod.sprout ?? 0,
      sapling: e.eod.sapling ?? 0,
      orchard: e.eod.orchard ?? 0,
      ironwood: e.eod.ironwood ?? 0,
      transparent: e.eod.transparent ?? 0,
    }));
  const days = RANGE_DAYS[range]; // undefined for 'all' → keep everything
  return days ? mapped.slice(-days) : mapped;
}

// Build pool history from the purpose-built, timestamped endpoints, with the legacy
// flows-reconstruction as a resilience fallback if the primary source hiccups.
async function getPoolHistory(range: string): Promise<PoolPoint[]> {
  try {
    const primary = HOURLY_RANGES.includes(range)
      ? await getPoolHistoryHourly(range)
      : await getPoolHistoryDaily(range);
    if (primary.length > 1) return primary;
  } catch (err) {
    console.warn(`[pools API] primary source failed for ${range}, falling back to flows:`, err instanceof Error ? err.message : err);
  }
  return getPoolHistoryFromFlows(range);
}

// LEGACY FALLBACK - get pool history from the /api/flows endpoint.
// For hourly ranges: flows include a pools object directly.
// For daily ranges: reconstruct from net flows against the current chain snapshot.
async function getPoolHistoryFromFlows(range: string) {
  const flowUrl = getFlowsUrl(range);
  const flowRes = await fetch(flowUrl, {
    headers: getApiHeaders(),
  });
  if (!flowRes.ok) throw new Error(`Failed to fetch flow data: ${flowRes.status}`);
  const flowData = await flowRes.json();

  if (!flowData.data || flowData.data.length === 0) {
    throw new Error('No flow data available');
  }


  // For hourly data, extract pools directly from flow entries
  if (flowData.granularity === 'hourly') {
    const history = flowData.data
      .filter((entry: { pools?: object }) => entry.pools)
      .map((entry: { timestamp: string; pools: Record<string, number | { total: number }> }) => ({
        timestamp: entry.timestamp,
        sprout: getPoolValue(entry.pools.sprout),
        sapling: getPoolValue(entry.pools.sapling),
        orchard: getPoolValue(entry.pools.orchard),
        ironwood: getPoolValue(entry.pools.ironwood),
        transparent: getPoolValue(entry.pools.transparent),
      }));

    return history;
  }

  // For daily data, reconstruct from net flows (existing logic)
  const chainRes = await fetch(`${API_CONFIG.baseUrl}/api/chain`, {
    headers: getApiHeaders(),
  });
  if (!chainRes.ok) throw new Error('Failed to fetch chain data');
  const chainData = await chainRes.json();

  let sprout = chainData.pools?.sprout || 0;
  let sapling = chainData.pools?.sapling || 0;
  let orchard = chainData.pools?.orchard || 0;
  let ironwood = chainData.pools?.ironwood || 0;
  const transparent = chainData.pools?.transparent || 0;

  const flows = [...flowData.data].reverse();
  const history = [];

  history.push({
    timestamp: new Date().toISOString().split('T')[0],
    sprout,
    sapling,
    orchard,
    ironwood,
    transparent,
  });

  for (const flow of flows) {
    sprout -= flow.net?.sprout || 0;
    sapling -= flow.net?.sapling || 0;
    orchard -= flow.net?.orchard || 0;
    ironwood -= flow.net?.ironwood || 0;

    history.push({
      timestamp: flow.date || flow.timestamp,
      sprout: Math.max(0, sprout),
      sapling: Math.max(0, sapling),
      orchard: Math.max(0, orchard),
      ironwood: Math.max(0, ironwood),
      transparent,
    });
  }

  return history.reverse();
}

async function fetchPoolData(range: string): Promise<unknown> {
  // Check cache first
  const cached = getCachedData(range);
  if (cached) {
    return cached;
  }

  // Check if there's already a pending request for this range
  const pending = pendingRequests.get(range);
  if (pending) {
    return pending;
  }

  // Create new request promise
  const requestPromise = (async () => {
    try {
      // Build history from the timestamped per-pool endpoints (/api/daily,
      // /api/flows/hourly), with a legacy flows fallback inside getPoolHistory.
      const poolHistory = await getPoolHistory(range);
      setCachedData(range, poolHistory);
      return poolHistory;
    } finally {
      pendingRequests.delete(range);
    }
  })();

  pendingRequests.set(range, requestPromise);
  return requestPromise;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const range = searchParams.get('range') || '1y';


  if (!VALID_RANGES.includes(range)) {
    return NextResponse.json(
      { error: `Invalid range. Valid options: ${VALID_RANGES.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const data = await fetchPoolData(range);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[pools API] Failed to fetch pools history:', error);
    // Ride out transient upstream outages on the last-known history if we have it,
    // so the charts keep rendering instead of erroring.
    const stale = getStaleData(range);
    if (stale) {
      return NextResponse.json(stale, { headers: { 'X-Pools-Source': 'stale-cache' } });
    }
    const errMsg = error instanceof Error ? error.message : 'Historical pool data not available';
    return NextResponse.json(
      { error: `Pool history unavailable: ${errMsg}` },
      { status: 503 }
    );
  }
}
