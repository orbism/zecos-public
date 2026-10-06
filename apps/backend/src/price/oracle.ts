// Self-hosted ZEC/USD price oracle.
//
// Fiat price is not on-chain, so it must come from markets - but instead of
// depending on a single aggregator (CoinGecko/CryptoCompare, which can deprecate
// or rate-limit), we take the MEDIAN of several keyless exchange tickers. The
// median tolerates any single source failing or returning an outlier. Results are
// cached briefly and served stale during a total outage so the app never hard-fails.

interface Source {
  name: string;
  url: string;
  headers?: Record<string, string>;
  parse: (json: any) => number;
}

// All keyless public tickers. Binance is best-effort (it geo-blocks some egress
// IPs); a failed source is simply dropped from the median.
const SOURCES: Source[] = [
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=ZECUSD',
    parse: (j) => {
      const result = j?.result ?? {};
      const key = Object.keys(result)[0];
      return parseFloat(result[key]?.c?.[0]); // c[0] = last trade price
    },
  },
  {
    name: 'coinbase',
    url: 'https://api.exchange.coinbase.com/products/ZEC-USD/ticker',
    headers: { 'User-Agent': 'zec-os-price-oracle' }, // Coinbase requires a UA
    parse: (j) => parseFloat(j?.price),
  },
  {
    name: 'gemini',
    url: 'https://api.gemini.com/v1/pubticker/zecusd',
    parse: (j) => parseFloat(j?.last),
  },
  {
    name: 'binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=ZECUSDT',
    parse: (j) => parseFloat(j?.price), // USDT ≈ USD
  },
];

const SOURCE_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 30_000;

export interface PriceResult {
  priceUsd: number;
  price: number; // alias for backward compatibility
  median: number;
  sources: Array<{ name: string; price: number }>;
  count: number;
  asOf: string;
  stale: boolean;
}

let cache: { data: PriceResult; timestamp: number } | null = null;
let inflight: Promise<PriceResult> | null = null;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function fetchSource(src: Source): Promise<{ name: string; price: number } | null> {
  try {
    const res = await fetch(src.url, {
      headers: src.headers,
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const price = src.parse(json);
    // Guard against NaN, 0, negatives, and absurd values from a malformed feed.
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) return null;
    return { name: src.name, price };
  } catch {
    return null;
  }
}

async function computePrice(): Promise<PriceResult> {
  const settled = await Promise.all(SOURCES.map(fetchSource));
  const ok = settled.filter((s): s is { name: string; price: number } => s !== null);

  if (ok.length === 0) {
    // Total outage - ride it out on the last-known price if we have one.
    if (cache) return { ...cache.data, stale: true };
    throw new Error('All price sources failed and no cached price is available');
  }

  const med = median(ok.map((s) => s.price));
  const result: PriceResult = {
    priceUsd: med,
    price: med,
    median: med,
    sources: ok,
    count: ok.length,
    asOf: new Date().toISOString(),
    stale: false,
  };
  cache = { data: result, timestamp: Date.now() };
  return result;
}

/** Current ZEC/USD price as the median of live exchange tickers (cached ~30s). */
export async function getSpotPrice(): Promise<PriceResult> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }
  // De-dupe concurrent refreshes so a burst of requests fans out to one round.
  if (inflight) return inflight;
  inflight = computePrice().finally(() => { inflight = null; });
  return inflight;
}
