/**
 * Pure maths for the investment calculator. No React, no fetching - so the
 * numbers can be checked directly.
 */

export interface SeriesPoint {
  /** Unix seconds, UTC. */
  t: number;
  price: number;
}

export type PayCurrency = 'usd' | 'eth' | 'btc';

export const CURRENCY_LABEL: Record<PayCurrency, string> = {
  usd: 'USD',
  eth: 'ETH',
  btc: 'BTC',
};

/** Parse a `YYYY-MM-DD` (optionally with `HH:MM`) as UTC seconds. */
export function toUnix(date: string, time = ''): number {
  const iso = time ? `${date}T${time}:00Z` : `${date}T00:00:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}

export function fromUnix(t: number): Date {
  return new Date(t * 1000);
}

/** Normalise `/api/prices` output (dates may be `YYYY-MM-DD` or unix ms). */
export function normalisePrices(raw: { timestamp: number | string; price: number }[]): SeriesPoint[] {
  return raw
    .map((p) => {
      const t =
        typeof p.timestamp === 'string'
          ? Math.floor(Date.parse(`${p.timestamp}T00:00:00Z`) / 1000)
          : Math.floor(p.timestamp / 1000);
      return { t, price: Number(p.price) };
    })
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.t - b.t);
}

/**
 * Price at (or most recently before) `t`.
 *
 * Deliberately does NOT interpolate: a price series is a record of observations,
 * and inventing a value between two of them would misreport what the market
 * actually did. Returns the last observation at or before the timestamp, plus
 * how stale that observation is so the caller can disclose it.
 */
export function priceAt(series: SeriesPoint[], t: number): { price: number; at: number; staleDays: number } | null {
  if (!series.length) return null;
  if (t < series[0].t) return null; // before the series begins - not knowable

  let lo = 0;
  let hi = series.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  const p = series[best];
  return { price: p.price, at: p.t, staleDays: Math.max(0, Math.round((t - p.t) / 86_400)) };
}

export interface Position {
  /** USD actually spent, after converting the pay currency at the buy date. */
  usdSpent: number;
  /** ZEC acquired at that date's price. */
  zec: number;
  zecPriceThen: number;
  zecPriceNow: number;
  valueNow: number;
  profit: number;
  /** Multiple of the original stake, e.g. 3.2 means 3.2x. */
  multiple: number;
  roiPct: number;
  /** Compound annual growth rate, %. Null for holdings under a month. */
  cagrPct: number | null;
  heldDays: number;
}

export function buildPosition(params: {
  amount: number;
  currency: PayCurrency;
  buyT: number;
  zec: SeriesPoint[];
  /** Required when currency is not USD. */
  payRates?: SeriesPoint[];
}): { position: Position; payRateThen: number } | { error: string } {
  const { amount, currency, buyT, zec, payRates } = params;
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter an amount greater than zero.' };
  if (!Number.isFinite(buyT)) return { error: 'Enter a valid date.' };
  if (!zec.length) return { error: 'ZEC price history unavailable.' };
  if (buyT > Date.now() / 1000) return { error: 'That date is in the future.' };

  const zecThen = priceAt(zec, buyT);
  if (!zecThen) {
    const first = fromUnix(zec[0].t).toISOString().slice(0, 10);
    return { error: `ZEC did not trade then - history starts ${first}.` };
  }

  let payRateThen = 1;
  if (currency !== 'usd') {
    if (!payRates?.length) return { error: `${CURRENCY_LABEL[currency]} rates unavailable.` };
    const r = priceAt(payRates, buyT);
    if (!r) {
      const first = fromUnix(payRates[0].t).toISOString().slice(0, 10);
      return { error: `${CURRENCY_LABEL[currency]} history starts ${first}.` };
    }
    payRateThen = r.price;
  }

  const usdSpent = amount * payRateThen;
  const zecAmount = usdSpent / zecThen.price;
  const zecPriceNow = zec[zec.length - 1].price;
  const valueNow = zecAmount * zecPriceNow;
  const heldDays = Math.max(0, Math.round((zec[zec.length - 1].t - buyT) / 86_400));
  const years = heldDays / 365.25;

  return {
    payRateThen,
    position: {
      usdSpent,
      zec: zecAmount,
      zecPriceThen: zecThen.price,
      zecPriceNow,
      valueNow,
      profit: valueNow - usdSpent,
      multiple: valueNow / usdSpent,
      roiPct: ((valueNow - usdSpent) / usdSpent) * 100,
      cagrPct: years >= 1 / 12 ? (Math.pow(valueNow / usdSpent, 1 / years) - 1) * 100 : null,
      heldDays,
    },
  };
}

export interface ValuePoint {
  t: number;
  /** Value of the ZEC position, USD. */
  value: number;
  /** Value if the original ETH/BTC had simply been held. Undefined for USD buys. */
  alt?: number;
}

/** Value of the holding over time, plus the "kept the ETH/BTC instead" line. */
export function valueSeries(params: {
  zec: SeriesPoint[];
  zecAmount: number;
  buyT: number;
  amount: number;
  currency: PayCurrency;
  payRates?: SeriesPoint[];
}): ValuePoint[] {
  const { zec, zecAmount, buyT, amount, currency, payRates } = params;
  const out: ValuePoint[] = [];
  for (const p of zec) {
    if (p.t < buyT) continue;
    const point: ValuePoint = { t: p.t, value: zecAmount * p.price };
    if (currency !== 'usd' && payRates?.length) {
      const r = priceAt(payRates, p.t);
      if (r) point.alt = amount * r.price;
    }
    out.push(point);
  }
  return out;
}

export interface Extremes {
  peak: ValuePoint | null;
  trough: ValuePoint | null;
  /** Largest peak-to-trough fall after the buy, as a positive %. */
  maxDrawdownPct: number;
  /** Fraction of days the position was above water. */
  daysInProfitPct: number;
}

export function extremesOf(series: ValuePoint[], usdSpent: number): Extremes {
  if (!series.length) {
    return { peak: null, trough: null, maxDrawdownPct: 0, daysInProfitPct: 0 };
  }
  let peak = series[0];
  let trough = series[0];
  let runningPeak = series[0].value;
  let maxDD = 0;
  let inProfit = 0;

  for (const p of series) {
    if (p.value > peak.value) peak = p;
    if (p.value < trough.value) trough = p;
    if (p.value > runningPeak) runningPeak = p.value;
    const dd = runningPeak > 0 ? ((runningPeak - p.value) / runningPeak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    if (p.value >= usdSpent) inProfit++;
  }

  return {
    peak,
    trough,
    maxDrawdownPct: maxDD,
    daysInProfitPct: (inProfit / series.length) * 100,
  };
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

export function fmtZec(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return `${n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 4 })} ZEC`;
}
