/**
 * What people are doing, as their own browsers report it.
 *
 * Presence alone says someone is here; this says where. Each heartbeat - the
 * guest ping, the signed-in session check - carries a small report from the
 * browser: which app has focus, what else is open, how long since they last
 * touched anything, what kind of device, where they came from. Kept in
 * memory, like guest presence: it is live state for the sysop's roster, not
 * history, and a restart costs nothing but the next heartbeat.
 *
 * Everything in it is client-supplied, so it is clamped on the way in and
 * never used for anything but display.
 */

import { parseClientApi, recordBeat } from './metrics';

export interface Activity {
  /** App id (window type, or the standalone route). */
  app: string | null;
  /** What the app is called on screen. */
  title: string | null;
  /** Everything else open, by title. */
  apps: string[];
  /** Seconds since their last click, key or touch, as of the report. */
  idle: number;
  path: string | null;
  /** Coarse device and browser, e.g. "iPhone Safari". */
  dev: string | null;
  /** The site that sent them, if it was not us. */
  ref: string | null;
  /** Whether the tab was in front. */
  vis: boolean;
}


const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 20_000;
const store = new Map<string, { a: Activity; at: number }>();

const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/** The report as an object: from a header (URI-encoded JSON) or a request body. */
function decode(raw: unknown): Record<string, unknown> | null {
  let o: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof o === 'string') {
    try { o = JSON.parse(decodeURIComponent(o)); } catch { return null; }
  }
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
}

export function parseActivity(raw: unknown): Activity | null {
  const r = decode(raw);
  if (!r) return null;
  return {
    app: str(r.app, 40),
    title: str(r.title, 60),
    apps: Array.isArray(r.apps) ? r.apps.map((x) => str(x, 40)).filter((x): x is string => !!x).slice(0, 12) : [],
    idle: Math.max(0, Math.min(86_400, Math.round(Number(r.idle) || 0))),
    path: str(r.path, 80),
    dev: str(r.dev, 40),
    ref: str(r.ref, 80),
    vis: r.vis !== false,
  };
}

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, e] of store) if (e.at < cutoff) store.delete(k);
}

/** Record a report under `key` ("u:<userId>" or "g:<guestId>"). Bad input is ignored. */
export function noteActivity(key: string, raw: unknown): void {
  const o = decode(raw);
  const a = parseActivity(o);
  if (!a) return;
  // ...and the same heartbeat feeds the usage history (time in apps, /api hits).
  recordBeat(key, a, parseClientApi(o?.api));
  if (store.size >= MAX_ENTRIES && !store.has(key)) prune();
  if (store.size >= MAX_ENTRIES && !store.has(key)) return;
  store.set(key, { a, at: Date.now() });
}

/** The latest report for `key` and when it arrived, or null if none in the last hour. */
export function getActivity(key: string): (Activity & { at: number }) | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { store.delete(key); return null; }
  return { ...e.a, at: e.at };
}

/** How many visitors reported in the last `withinMs` (the "online now" figure). */
export function liveCount(withinMs = 120_000): { users: number; guests: number } {
  const cut = Date.now() - withinMs;
  let users = 0, guests = 0;
  for (const [k, e] of store) if (e.at >= cut) { if (k.startsWith('u:')) users++; else guests++; }
  return { users, guests };
}
