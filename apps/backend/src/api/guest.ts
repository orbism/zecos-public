import { FastifyInstance, FastifyRequest } from 'fastify';
import { reverse as dnsReverse } from 'dns/promises';
import { getUser, clientIp as sharedClientIp } from './user';
import { isAdmin as isAdminUser } from '../lib/admin';
import { rateLimiter } from '../lib/ratelimit';
import { noteActivity, getActivity } from '../lib/activity';

// Lightweight presence + two-way chat for GUEST instances (no account, no
// session). Each guest browser holds a persistent random id and long-polls here;
// we track it in memory with its IP so the sysop can see it, and hold a per-guest
// message thread so the sysop and guest can talk both ways in near-real-time.
// Ephemeral by design - cleared on restart; single-instance (in-memory).
//
// BOOT vs BAN:
//   boot = one-time kick (delivered once, then cleared - the guest may rejoin).
//   ban  = persistent IP block (kept until unbanned; shown in the banned list).

const ACTIVE_MS = 2 * 60 * 1000;   // seen within → "online"
const RECENT_MS = 15 * 60 * 1000;  // listed at all if seen within
const PRUNE_MS = 60 * 60 * 1000;   // drop from memory after this
const HOLD_MS = 20 * 1000;         // long-poll: hold a request up to this long

/*
 * Bounds. Every map here is keyed by a CLIENT-SUPPLIED id and this route is
 * public, so without a ceiling a loop of random ids grows memory until the
 * process dies - and the only prune ran inside the sysop's roster view.
 */
const MAX_GUESTS = 5_000;          // distinct guest ids held at once
const MAX_WAITERS = 1_000;         // long-polls parked at once, in total
const MAX_WAITERS_PER_IP = 6;      // a browser has a handful of tabs, not hundreds
const PRUNE_EVERY_MS = 60 * 1000;  // prune on traffic, not only when the sysop looks
const GUEST_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const pingLimiter = rateLimiter({ windowMs: 60_000, max: 60 });   // per IP: one poll / second
const replyLimiter = rateLimiter({ windowMs: 60_000, max: 20 });
let parked = 0;
const parkedByIp = new Map<string, number>();
let lastPrune = 0;

interface Msg { seq: number; from: 'sysop' | 'guest'; body: string; at: number }
interface Guest { id: string; ip: string; name: string | null; firstSeen: number; lastSeen: number }
interface Ban { ip: string; name: string | null; guestId: string; at: number }
const guests = new Map<string, Guest>();
const threads = new Map<string, Msg[]>();  // full conversation, both directions
const booted = new Set<string>();          // one-time kicks (deliver once, then clear)
const ended = new Set<string>();           // sysop-closed conversations (guest window closes)
const bans = new Map<string, Ban>();       // IP → ban record (persistent)

// ── Long-poll plumbing ───────────────────────────────────────────────────────
let msgSeq = 0;
type Waiter = () => void;
const waiters = new Map<string, Set<Waiter>>();
function notify(id: string) {
  const ws = waiters.get(id);
  if (ws && ws.size) { const list = [...ws]; ws.clear(); for (const w of list) w(); }
}
function maxSeq(id: string): number {
  const t = threads.get(id);
  return t && t.length ? t[t.length - 1].seq : 0;
}
function waitForChange(id: string, clientSeq: number, changed: boolean, ip: string): Promise<void> {
  if (changed || maxSeq(id) > clientSeq) return Promise.resolve();
  // Over the parking limits: answer now instead of holding. The client simply
  // polls again; nothing is lost, and nothing can pin a thousand sockets.
  if (parked >= MAX_WAITERS || (parkedByIp.get(ip) ?? 0) >= MAX_WAITERS_PER_IP) return Promise.resolve();
  parked++; parkedByIp.set(ip, (parkedByIp.get(ip) ?? 0) + 1);
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(to); waiters.get(id)?.delete(w);
      parked--; const n = (parkedByIp.get(ip) ?? 1) - 1; if (n <= 0) parkedByIp.delete(ip); else parkedByIp.set(ip, n);
      resolve();
    };
    const w: Waiter = finish;
    const to = setTimeout(finish, HOLD_MS);
    const set = waiters.get(id) ?? new Set<Waiter>();
    set.add(w); waiters.set(id, set);
  });
}

// Admin is the ADMIN_ADDRESS account, never a display name - see lib/admin.
function isAdmin(user: { address?: string | null } | null): boolean { return isAdminUser(user); }
async function requireAdmin(req: FastifyRequest) {
  const u = await getUser(req);
  return u && u.isVerified && isAdmin(u) ? u : null;
}
// Same trust rule as user.ts clientIp: forwarded headers only from our proxy.
function clientIp(req: FastifyRequest): string {
  return sharedClientIp(req) || 'unknown';
}
function pushMsg(id: string, from: 'sysop' | 'guest', body: string) {
  const t = threads.get(id) ?? [];
  t.push({ seq: ++msgSeq, from, body, at: Date.now() });
  threads.set(id, t.slice(-100));
  ended.delete(id); // a new message reopens a closed conversation
  notify(id);
}
function prune() {
  lastPrune = Date.now();
  const cutoff = Date.now() - PRUNE_MS;
  for (const [id, g] of guests) if (g.lastSeen < cutoff) { guests.delete(id); threads.delete(id); booted.delete(id); ended.delete(id); waiters.delete(id); }
  // Still over the ceiling after dropping the idle: evict the least recently seen.
  if (guests.size > MAX_GUESTS) {
    const victims = [...guests.values()].sort((a, b) => a.lastSeen - b.lastSeen).slice(0, guests.size - MAX_GUESTS);
    for (const g of victims) { guests.delete(g.id); threads.delete(g.id); booted.delete(g.id); ended.delete(g.id); waiters.delete(g.id); }
  }
}
function pruneIfDue() { if (Date.now() - lastPrune > PRUNE_EVERY_MS) prune(); }

// Currently-connected guests for the PUBLIC roster - anonymized, no IPs.
export function publicGuests(): { handle: string }[] {
  const now = Date.now();
  return [...guests.values()]
    .filter((g) => now - g.lastSeen < ACTIVE_MS && !bans.has(g.ip))
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((g) => ({ handle: g.name?.trim() || `n00b-${g.id.replace(/^g-/, '').slice(0, 4)}` }));
}
// Returns a leave signal if this guest/IP should be turned away (else null).
// A one-time boot is consumed here (delivered once, then cleared).
function leaveSignal(guestId: string, ip: string): { booted: true; banned?: boolean; reason: string } | null {
  if (bans.has(ip)) return { booted: true, banned: true, reason: 'This device is banned by the sysop.' };
  if (booted.has(guestId)) { booted.delete(guestId); return { booted: true, reason: 'You were removed by the sysop.' }; }
  return null;
}

export async function guestRoutes(server: FastifyInstance) {
  // Guest heartbeat + message long-poll (public).
  server.post<{ Body: { guestId?: string; name?: string; seq?: number; activity?: unknown } }>('/ping', async (req, reply) => {
    const guestId = (req.body?.guestId ?? '').trim().slice(0, 64);
    if (!guestId || !GUEST_ID_RE.test(guestId)) return reply.status(400).send({ error: 'guestId required' });
    const ip = clientIp(req);
    if (pingLimiter.hit(ip)) return reply.status(429).send({ error: 'slow down' });
    pruneIfDue();
    const pre = leaveSignal(guestId, ip);
    if (pre) return reply.send({ ok: true, ...pre });
    const now = Date.now();
    const g = guests.get(guestId);
    if (g) { g.lastSeen = now; g.ip = ip; if (req.body?.name) g.name = req.body.name.slice(0, 40); }
    else {
      if (guests.size >= MAX_GUESTS) { prune(); }
      if (guests.size >= MAX_GUESTS) return reply.status(503).send({ error: 'guest lobby is full - try again shortly' });
      guests.set(guestId, { id: guestId, ip, name: req.body?.name?.slice(0, 40) ?? null, firstSeen: now, lastSeen: now });
    }
    // What they are doing, as their browser reports it (see lib/activity).
    noteActivity(`g:${guestId}`, req.body?.activity);

    await waitForChange(guestId, Number(req.body?.seq ?? 0), ended.has(guestId), ip);
    const post = leaveSignal(guestId, ip); // a boot/ban may have landed during the hold
    if (post) return reply.send({ ok: true, ...post });
    return reply.send({ ok: true, booted: false, ended: ended.has(guestId), thread: (threads.get(guestId) ?? []).slice(-50), seq: maxSeq(guestId) });
  });

  // Guest reply (public).
  server.post<{ Body: { guestId?: string; body?: string } }>('/reply', async (req, reply) => {
    const guestId = (req.body?.guestId ?? '').trim().slice(0, 64);
    const body = (req.body?.body ?? '').trim();
    if (!guestId || !GUEST_ID_RE.test(guestId) || !body) return reply.status(400).send({ error: 'guestId + body required' });
    const ip = clientIp(req);
    if (replyLimiter.hit(ip)) return reply.status(429).send({ error: 'slow down' });
    const sig = leaveSignal(guestId, ip);
    if (sig) return reply.send({ ok: true, ...sig });
    // A reply only lands on a guest that has pinged: no thread for an id that
    // was never here, so /reply cannot be used to fill memory either.
    const g = guests.get(guestId);
    if (!g) return reply.status(404).send({ error: 'unknown guest - ping first' });
    g.lastSeen = Date.now();
    pushMsg(guestId, 'guest', body.slice(0, 500));
    return reply.send({ ok: true, thread: (threads.get(guestId) ?? []).slice(-50), seq: maxSeq(guestId) });
  });

  // ── Sysop ────────────────────────────────────────────────────────────────
  server.get('/admin/list', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    prune();
    const now = Date.now();
    const list = [...guests.values()]
      .filter((g) => now - g.lastSeen < RECENT_MS)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((g) => ({
        guestId: g.id, ip: g.ip, name: g.name,
        online: now - g.lastSeen < ACTIVE_MS,
        banned: bans.has(g.ip),
        firstSeen: g.firstSeen, lastSeen: g.lastSeen,
        msgs: (threads.get(g.id) ?? []).length,
        activity: getActivity(`g:${g.id}`),
      }));
    return reply.send({ guests: list, bans: [...bans.values()].sort((a, b) => b.at - a.at) });
  });

  server.get<{ Querystring: { guestId?: string; seq?: string } }>('/admin/thread', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    const id = (req.query?.guestId ?? '').trim();
    if (!id) return reply.status(400).send({ error: 'guestId required' });
    await waitForChange(id, Number(req.query?.seq ?? 0), false, 'sysop');
    const g = guests.get(id);
    return reply.send({
      thread: (threads.get(id) ?? []).slice(-50), seq: maxSeq(id),
      online: g ? Date.now() - g.lastSeen < ACTIVE_MS : false,
      ended: ended.has(id), booted: booted.has(id), banned: g ? bans.has(g.ip) : false,
      name: g?.name ?? null, ip: g?.ip ?? 'unknown',
    });
  });

  server.post<{ Body: { guestId: string; body: string } }>('/admin/message', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    const { guestId, body } = req.body ?? {};
    if (!guestId || !body?.trim()) return reply.status(400).send({ error: 'guestId + body required' });
    pushMsg(guestId, 'sysop', body.trim().slice(0, 500));
    return reply.send({ ok: true, thread: (threads.get(guestId) ?? []).slice(-50), seq: maxSeq(guestId) });
  });

  server.post<{ Body: { guestId: string } }>('/admin/end', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    if (req.body?.guestId) { ended.add(req.body.guestId); notify(req.body.guestId); }
    return reply.send({ ok: true });
  });

  // Boot: one-time kick. The guest is dropped to the splash and MAY rejoin.
  server.post<{ Body: { guestId: string } }>('/admin/boot', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    if (!req.body?.guestId) return reply.status(400).send({ error: 'guestId required' });
    booted.add(req.body.guestId); notify(req.body.guestId);
    return reply.send({ ok: true });
  });

  // Ban: persistent IP block (and kick now). Survives disconnect; listed until unbanned.
  server.post<{ Body: { guestId: string } }>('/admin/ban', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    const id = req.body?.guestId;
    if (!id) return reply.status(400).send({ error: 'guestId required' });
    const g = guests.get(id);
    if (!g || !g.ip || g.ip === 'unknown') return reply.status(400).send({ error: 'No known IP for this guest' });
    bans.set(g.ip, { ip: g.ip, name: g.name, guestId: id, at: Date.now() });
    notify(id);
    return reply.send({ ok: true, ip: g.ip });
  });

  // IP intel for the sysop - reverse-DNS + Geo/ASN/ISP (via ip-api.com).
  server.post<{ Body: { ip: string } }>('/admin/ipinfo', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    const ip = (req.body?.ip ?? '').trim();
    if (!ip || ip === 'unknown') return reply.status(400).send({ error: 'No IP' });
    let rdns: string[] = [];
    try { rdns = await dnsReverse(ip); } catch { /* no PTR */ }
    let geo: unknown = null;
    try {
      const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,isp,org,as,asname,reverse,mobile,proxy,hosting,query`);
      geo = await r.json();
    } catch { /* lookup unavailable */ }
    return reply.send({ ip, rdns, geo, banned: bans.has(ip) });
  });

  server.post<{ Body: { ip: string } }>('/admin/unban', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    if (req.body?.ip) bans.delete(req.body.ip);
    return reply.send({ ok: true, bans: [...bans.values()].sort((a, b) => b.at - a.at) });
  });
}
