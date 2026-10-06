'use client';

import { useWindowStore } from '@/store/windowStore';

/**
 * What this browser is doing, for the sysop's roster.
 *
 * Rides on heartbeats that already exist - the guest ping, the signed-in
 * session check - so it adds no requests. It says which app has focus, what
 * else is open, how long since the person last touched anything (a real idle
 * time, not "time since the last heartbeat"), a coarse device and browser,
 * and the site that sent them, plus how many /api calls this tab made since the
 * last report (route patterns with ids folded to :id, counts and timings only:
 * the sysop's Metrics app reads node-stack load from them). Nothing that identifies a person: no user
 * agent string, no screen size, no locale.
 */

export interface ActivityReport {
  /** /api calls since the last report: route -> [hits, server errors, total ms, slowest ms]. */
  api?: Record<string, [number, number, number, number]>;
  app: string | null;
  title: string | null;
  apps: string[];
  idle: number;
  path: string;
  dev: string;
  ref: string | null;
  vis: boolean;
}

let lastInput = Date.now();
let installed = false;
// /api traffic since the last heartbeat, for the sysop's Metrics app (node stack usage)
const api = new Map<string, [number, number, number, number]>();
/** Ids, hashes, addresses and heights fold into ":id", so routes group. */
const routeOf = (path: string) => path.split('/').map((seg) => (/^\d{2,}$/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) || seg.length > 24 ? ':id' : seg)).join('/');
function countFetch(route: string, ms: number, failed: boolean) {
  const a = api.get(route) ?? [0, 0, 0, 0];
  a[0]++; if (failed) a[1]++; a[2] += Math.round(ms); a[3] = Math.max(a[3], Math.round(ms));
  api.set(route, a);
}
/** Count same-origin /api calls. Wraps fetch once; the call itself is untouched. */
function instrumentFetch() {
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL | null = null;
    try { url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href); } catch { /* not a URL we can read */ }
    if (!url || url.origin !== location.origin || !url.pathname.startsWith('/api/')) return orig(input, init);
    const route = routeOf(url.pathname), t0 = performance.now();
    try {
      const res = await orig(input, init);
      countFetch(route, performance.now() - t0, res.status >= 500);
      return res;
    } catch (e) {
      countFetch(route, performance.now() - t0, true);
      throw e;
    }
  };
}
/** The counts since the last report (busiest 25 routes), then start again. */
function drainApi(): ActivityReport['api'] {
  if (!api.size) return undefined;
  const top = [...api.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25);
  api.clear();
  return Object.fromEntries(top);
}
let referrer: string | null = null;

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  instrumentFetch();
  const bump = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, bump, { passive: true, capture: true });
  }
  try {
    const r = document.referrer ? new URL(document.referrer) : null;
    referrer = r && r.host !== location.host ? r.host : null;
  } catch { /* no referrer */ }
}

function device(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux' : 'other';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'other';
  return `${os} ${browser}`;
}

export function currentActivity(): ActivityReport {
  install();
  const path = location.pathname;
  let app: string | null, title: string | null, apps: string[] = [];
  if (path === '/') {
    // The desktop: the focused window, else the one on top.
    const { windows, activeWindowId } = useWindowStore.getState();
    const shown = windows.filter((w) => !w.minimized && !w.parked);
    const focused = shown.find((w) => w.id === activeWindowId) ?? shown[shown.length - 1];
    app = focused?.type ?? 'desktop';
    title = focused?.title ?? 'Desktop';
    apps = windows.filter((w) => w !== focused).map((w) => w.title).slice(0, 12);
  } else {
    // A standalone page: the route is the app.
    app = path.split('/')[1] || null;
    title = document.title.split(/\s+[|·]\s+/)[0]?.trim() || app;
  }
  return {
    api: drainApi(),
    app, title, apps,
    idle: Math.round((Date.now() - lastInput) / 1000),
    path, dev: device(), ref: referrer,
    vis: document.visibilityState === 'visible',
  };
}

/** The report as a header value (headers must be plain ASCII). */
export function activityHeader(): string {
  return encodeURIComponent(JSON.stringify(currentActivity()));
}
