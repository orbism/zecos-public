import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getUser } from './user';
import { isAdmin } from '../lib/admin';

/**
 * System Debugger (sysop only): traffic passing through this backend and its
 * recent errors, for whoever runs the deployment.
 *
 * In memory, last hour only, gone on restart. Kept per request: the route
 * PATTERN (never the URL, so no ids or query strings), method, status and
 * time taken. Never an IP, a user, a header or a body. Error text is scrubbed
 * of IPs, addresses, keys, tokens and hashes before it is stored.
 */

const MINUTES = 60;
const MAX_ERRORS = 50;

type Minute = { t: number; requests: number; errors: number; ms: number };
const minutes = new Map<number, Minute>();
const routes = new Map<string, { method: string; route: string; t: number; n: number; errors: number; ms: number }[]>();
const errors: { at: string; route: string | null; status: number | null; message: string }[] = [];

/** Strips anything that could identify a person or a secret from a line of text. */
export function scrub(text: string): string {
  return text
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    // IPv6: four or more groups, or any '::' form. Clock times (two colons) are left alone.
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|(?:\b(?:[0-9a-f]{1,4}:)*[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}(?::|\b))*/gi, '[ip]')
    .replace(/\b(?:t1|t3|tm|u1|utest1?|zs1|ztestsapling1|uview1|uivk1|zxviews1)[0-9a-z]{20,}\b/gi, '[address]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[hash]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [token]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .slice(0, 500);
}

const minuteOf = (ms: number) => Math.floor(ms / 60_000);
function prune(now: number) {
  const oldest = minuteOf(now) - MINUTES + 1;
  for (const k of minutes.keys()) if (k < oldest) minutes.delete(k);
  for (const [k, list] of routes) {
    const kept = list.filter((b) => b.t >= oldest);
    if (kept.length) routes.set(k, kept); else routes.delete(k);
  }
}

function recordError(route: string | null, status: number | null, message: string) {
  errors.unshift({ at: new Date().toISOString(), route, status, message: scrub(message) });
  if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS;
}

let installed = false;
/** Hooks on the ROOT server, so every route is counted. Call once from registerRoutes. */
export function installDebugger(server: FastifyInstance): void {
  if (installed) return;
  installed = true;
  server.addHook('onResponse', async (req, reply) => {
    const now = Date.now();
    const m = minuteOf(now);
    const ms = reply.elapsedTime;
    const failed = reply.statusCode >= 500;
    const row = minutes.get(m) ?? { t: m, requests: 0, errors: 0, ms: 0 };
    row.requests++; row.ms += ms; if (failed) row.errors++;
    minutes.set(m, row);
    const route = req.routeOptions?.url ?? '(no route)';
    const key = `${req.method} ${route}`;
    const list = routes.get(key) ?? [];
    let b = list[list.length - 1];
    if (!b || b.t !== m) { b = { method: req.method, route, t: m, n: 0, errors: 0, ms: 0 }; list.push(b); routes.set(key, list); }
    b.n++; b.ms += ms; if (failed) b.errors++;
    if (minutes.size > MINUTES + 5) prune(now);
  });
  server.addHook('onError', async (req, reply, error) => {
    recordError(req.routeOptions?.url ?? null, reply.statusCode >= 400 ? reply.statusCode : 500, error.message);
  });
  // Errors logged outside any request (background jobs) count too.
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try { recordError(null, null, args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); } catch { /* never let the debugger break logging */ }
    orig(...args);
  };
}

async function requireSysop(req: FastifyRequest) {
  const user = await getUser(req);
  return user && user.isVerified && isAdmin(user) ? user : null;
}

export async function debugRoutes(server: FastifyInstance) {
  server.get('/', async (req, reply) => {
    if (!(await requireSysop(req))) return reply.code(403).send({ error: 'Sysop only' });
    const now = Date.now();
    prune(now);
    const first = minuteOf(now) - MINUTES + 1;
    const series = Array.from({ length: MINUTES }, (_, i) => {
      const r = minutes.get(first + i);
      return { t: new Date((first + i) * 60_000).toISOString(), requests: r?.requests ?? 0, errors: r?.errors ?? 0, avgMs: r?.requests ? Math.round(r.ms / r.requests) : 0 };
    });
    const top = [...routes.values()].map((list) => {
      const n = list.reduce((s, b) => s + b.n, 0);
      return { method: list[0]!.method, route: list[0]!.route, requests: n, errors: list.reduce((s, b) => s + b.errors, 0), avgMs: Math.round(list.reduce((s, b) => s + b.ms, 0) / Math.max(1, n)) };
    }).sort((a, b) => b.requests - a.requests).slice(0, 15);
    return { series, routes: top, errors };
  });
}
