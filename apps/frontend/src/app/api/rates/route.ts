import { NextRequest, NextResponse } from 'next/server';

/**
 * Historical USD rates for the currencies someone might have *paid* in.
 *
 * Kraken's public OHLC is keyless but returns at most ~720 candles per request,
 * so daily alone only reaches ~2 years back. Weekly reaches 2013-2015. We fetch
 * both and splice: weekly for the deep history, daily once it takes over. That
 * covers every date ZEC has existed (from 2016-10-28) without a backend change
 * or an API key.
 */

const PAIRS: Record<string, string> = {
  eth: 'ETHUSD',
  btc: 'XBTUSD',
};

const DAY = 86_400;
const CACHE_TTL = 30 * 60 * 1000; // rates this old are fine for a what-if calc

interface Point { t: number; price: number } // t = unix seconds, UTC midnight-ish

const cache = new Map<string, { data: unknown; at: number }>();

type Candle = [number, string, string, string, string, string, string, number];

async function krakenOHLC(pair: string, interval: number): Promise<Point[]> {
  const res = await fetch(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`,
    { headers: { 'User-Agent': 'zec-os/1.0' } }
  );
  if (!res.ok) throw new Error(`Kraken ${pair}@${interval} -> ${res.status}`);
  const json = await res.json();
  if (json.error?.length) throw new Error(`Kraken: ${json.error.join(', ')}`);
  const result = json.result ?? {};
  const series = Object.entries(result).find(([k]) => k !== 'last')?.[1] as Candle[] | undefined;
  if (!series?.length) throw new Error(`Kraken ${pair}: empty series`);
  // c[0] = time, c[4] = close
  return series.map((c) => ({ t: c[0], price: parseFloat(c[4]) })).filter((p) => Number.isFinite(p.price));
}

/**
 * Weekly candles up to the point daily takes over, then daily. Weekly points are
 * expanded to one point per day (flat within the week) so lookups don't have to
 * care which resolution a date falls in - the coarser origin is reported in
 * `weeklyBefore` so the UI can say so.
 */
function splice(weekly: Point[], daily: Point[]): { points: Point[]; weeklyBefore: number | null } {
  if (!daily.length) return { points: weekly, weeklyBefore: null };
  const dailyStart = daily[0].t;
  const out: Point[] = [];

  for (let i = 0; i < weekly.length; i++) {
    const w = weekly[i];
    if (w.t >= dailyStart) break;
    const next = Math.min(weekly[i + 1]?.t ?? w.t + 7 * DAY, dailyStart);
    for (let t = w.t; t < next; t += DAY) out.push({ t, price: w.price });
  }
  out.push(...daily);
  return { points: out, weeklyBefore: weekly.length ? dailyStart : null };
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').toLowerCase();
  const pair = PAIRS[symbol];
  if (!pair) {
    return NextResponse.json(
      { error: `Unknown symbol. Supported: ${Object.keys(PAIRS).join(', ')}` },
      { status: 400 }
    );
  }

  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_TTL) return NextResponse.json(hit.data);

  try {
    const [weekly, daily] = await Promise.all([
      krakenOHLC(pair, 10080),
      krakenOHLC(pair, 1440).catch(() => [] as Point[]),
    ]);
    const { points, weeklyBefore } = splice(weekly, daily);
    const data = {
      symbol,
      pair,
      count: points.length,
      weeklyBefore, // unix seconds; points older than this are weekly-resolution
      prices: points,
    };
    cache.set(symbol, { data, at: Date.now() });
    return NextResponse.json(data);
  } catch (e) {
    // Serve a stale copy rather than breaking the calculator over a blip.
    const stale = cache.get(symbol);
    if (stale) return NextResponse.json(stale.data, { headers: { 'X-Rates-Source': 'stale-cache' } });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Rate lookup failed' },
      { status: 502 }
    );
  }
}
