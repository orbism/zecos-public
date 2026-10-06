import crypto from 'crypto';
import { badgeLookup } from '../lib/badges';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ImProfile, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getUser } from './user';
import { adminAddress, isAdmin } from '../lib/admin';
import { rateLimiter } from '../lib/ratelimit';

/**
 * Zcash Instant Messenger.
 *
 *   GET  /api/im/me                  me: handle, share slug, avatar
 *   PUT  /api/im/me/avatar           { kind: 'gen'|'preset', seed } | { kind: 'upload', data }
 *   PUT  /api/im/me/status           { presence?: 'online'|'away'|'invisible', doing?: string | null }
 *   GET  /api/im/buddies             buddy list, requests both ways, unread per buddy, presence
 *   GET  /api/im/lookup/:slug        who a share link belongs to, and where we stand
 *   POST /api/im/request             { slug }: ask to be buddies (accepts theirs if they asked first)
 *   POST /api/im/respond             { userId, accept }
 *   POST /api/im/remove              { userId }: unbuddy, or cancel a request
 *   GET  /api/im/messages/:userId    ?after=ISO - the chat, and marks what I received as read
 *   POST /api/im/messages/:userId    { body }
 *   GET  /api/im/unread              { total } - the taskbar badge
 *
 * Verified accounts only. Nothing here ever returns an address: a person is a
 * handle, an avatar and whether they are online. The sysop is everybody's
 * buddy without anyone asking, and sees everyone - computed, never stored.
 */

const MAX_BODY = 1000;
const MAX_DOING = 80;
const PRESENCE = new Set(['online', 'away', 'invisible']);
const MAX_AVATAR = 60_000;
const MAX_PENDING_OUT = 50;
const ONLINE_MS = 3 * 60_000;
const PAGE = 100;

const sendLimiter = rateLimiter({ windowMs: 60_000, max: 30 });
const requestLimiter = rateLimiter({ windowMs: 10 * 60_000, max: 20 });

const handleOf = (u: Pick<User, 'id' | 'displayName'>) => u.displayName ?? `user-${u.id.slice(-5)}`;
const pair = (x: string, y: string) => (x < y ? { aId: x, bId: y } : { aId: y, bId: x });

/** Everyone starts on a generated face seeded by their id, until they choose. */
function avatarOf(userId: string, p?: ImProfile | null) {
  if (!p) return { kind: 'gen', seed: userId };
  return p.avatarKind === 'upload' && p.avatarData
    ? { kind: 'upload', data: p.avatarData }
    : { kind: p.avatarKind, seed: p.avatarSeed };
}

async function ensureProfile(userId: string): Promise<ImProfile> {
  const have = await prisma.imProfile.findUnique({ where: { userId } });
  if (have) return have;
  for (let i = 0; i < 3; i++) {
    try {
      return await prisma.imProfile.create({
        data: { userId, slug: crypto.randomBytes(8).toString('base64url'), avatarSeed: userId },
      });
    } catch {
      // Slug collision (astronomically rare) or a concurrent create: re-read, else retry.
      const again = await prisma.imProfile.findUnique({ where: { userId } });
      if (again) return again;
    }
  }
  throw new Error('could not create IM profile');
}

let sysopCache: { at: number; id: string | null } | null = null;
async function sysopId(): Promise<string | null> {
  if (sysopCache && Date.now() - sysopCache.at < 60_000) return sysopCache.id;
  const a = adminAddress();
  const u = a ? await prisma.user.findFirst({ where: { address: a, isVerified: true }, select: { id: true } }) : null;
  sysopCache = { at: Date.now(), id: u?.id ?? null };
  return sysopCache.id;
}

async function onlineIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.userSession.findMany({
    where: {
      userId: { in: ids }, revokedAt: null, expiresAt: { gt: new Date() },
      lastSeenAt: { gt: new Date(Date.now() - ONLINE_MS) },
    },
    select: { userId: true }, distinct: ['userId'],
  });
  return new Set(rows.map((r) => r.userId));
}

/**
 * Handle, avatar, status and "doing" for a set of users - and nothing else
 * about them. Status is 'online' | 'away' | 'offline'; someone invisible is
 * 'offline' to everyone except the sysop, who sees them with `invisible` set.
 */
async function people(ids: string[], sysop: string | null, viewerIsSysop = false) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map<string, ReturnType<typeof shape>>();
  const [users, profiles, online, bl] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: uniq }, isVerified: true }, select: { id: true, displayName: true } }),
    prisma.imProfile.findMany({ where: { userId: { in: uniq } } }),
    onlineIds(uniq),
    badgeLookup(),
  ]);
  const prof = new Map(profiles.map((p) => [p.userId, p]));
  function shape(u: { id: string; displayName: string | null }) {
    const p = prof.get(u.id);
    const invisible = p?.presence === 'invisible';
    const live = online.has(u.id) && (!invisible || viewerIsSysop);
    const status = !live ? 'offline' : p?.presence === 'away' ? 'away' : 'online';
    return {
      id: u.id, handle: handleOf(u), badges: bl.forUser(u.id), avatar: avatarOf(u.id, p), online: live, status,
      doing: p?.doing ?? null, sysop: u.id === sysop, ...(viewerIsSysop && invisible ? { invisible: true } : {}),
    };
  }
  return new Map(users.map((u) => [u.id, shape(u)]));
}

async function canMessage(me: User, otherId: string, sysop: string | null): Promise<boolean> {
  if (isAdmin(me) || otherId === sysop) return true;
  const row = await prisma.imBuddy.findUnique({ where: { aId_bId: pair(me.id, otherId) } });
  return row?.status === 'accepted';
}

export async function imRoutes(server: FastifyInstance) {
  /** Every route: a verified account, or 401. */
  const me = async (req: FastifyRequest, reply: FastifyReply) => {
    const u = await getUser(req);
    if (!u) { reply.status(401).send({ error: 'Sign in with a verified account to use ZIM' }); return null; }
    return u;
  };

  server.get('/me', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    const p = await ensureProfile(u.id);
    return reply.send({
      id: u.id, handle: handleOf(u), badges: (await badgeLookup()).forUser(u.id), slug: p.slug, avatar: avatarOf(u.id, p), sysop: isAdmin(u),
      presence: p.presence, doing: p.doing,
    });
  });

  server.put<{ Body: { kind?: unknown; seed?: unknown; data?: unknown } }>('/me/avatar', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    const { kind, seed, data } = req.body ?? {};
    await ensureProfile(u.id);
    if (kind === 'gen' || kind === 'preset') {
      if (typeof seed !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(seed)) return reply.status(400).send({ error: 'Bad seed' });
      const p = await prisma.imProfile.update({ where: { userId: u.id }, data: { avatarKind: kind, avatarSeed: seed, avatarData: null } });
      return reply.send({ avatar: avatarOf(u.id, p) });
    }
    if (kind === 'upload') {
      if (typeof data !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data))
        return reply.status(400).send({ error: 'Picture must be a PNG, JPEG or WebP' });
      if (data.length > MAX_AVATAR) return reply.status(413).send({ error: 'Picture is too large' });
      const p = await prisma.imProfile.update({ where: { userId: u.id }, data: { avatarKind: 'upload', avatarData: data } });
      return reply.send({ avatar: avatarOf(u.id, p) });
    }
    return reply.status(400).send({ error: 'kind must be gen, preset or upload' });
  });

  server.put<{ Body: { presence?: unknown; doing?: unknown } }>('/me/status', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    const { presence, doing } = req.body ?? {};
    const data: { presence?: string; doing?: string | null } = {};
    if (presence !== undefined) {
      if (typeof presence !== 'string' || !PRESENCE.has(presence)) return reply.status(400).send({ error: 'presence must be online, away or invisible' });
      data.presence = presence;
    }
    if (doing !== undefined) {
      if (doing !== null && typeof doing !== 'string') return reply.status(400).send({ error: 'doing must be text' });
      const t = typeof doing === 'string' ? doing.replace(/\s+/g, ' ').trim() : '';
      if (t.length > MAX_DOING) return reply.status(400).send({ error: `At most ${MAX_DOING} characters` });
      data.doing = t || null;
    }
    await ensureProfile(u.id);
    const p = await prisma.imProfile.update({ where: { userId: u.id }, data });
    return reply.send({ presence: p.presence, doing: p.doing });
  });

  server.get('/buddies', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    const sysop = await sysopId();
    const [rows, unread] = await Promise.all([
      prisma.imBuddy.findMany({ where: { OR: [{ aId: u.id }, { bId: u.id }] } }),
      prisma.imMessage.groupBy({ by: ['fromId'], where: { toId: u.id, readAt: null }, _count: { _all: true } }),
    ]);
    const other = (r: { aId: string; bId: string }) => (r.aId === u.id ? r.bId : r.aId);
    let buddyIds = rows.filter((r) => r.status === 'accepted').map(other);
    if (isAdmin(u)) {
      const all = await prisma.user.findMany({ where: { isVerified: true, id: { not: u.id } }, select: { id: true } });
      buddyIds = all.map((x) => x.id);
    } else if (sysop && sysop !== u.id) buddyIds.push(sysop);
    const pending = rows.filter((r) => r.status === 'pending');
    const inIds = pending.filter((r) => r.requestedBy !== u.id).map(other);
    const outIds = pending.filter((r) => r.requestedBy === u.id).map(other);
    // Anyone who wrote to me counts too, so an unread message is never invisible.
    const unreadBy = new Map(unread.map((x) => [x.fromId, x._count._all]));
    const who = await people([...buddyIds, ...inIds, ...outIds, ...unreadBy.keys()], sysop, isAdmin(u));
    const list = (ids: string[]) => [...new Set(ids)].map((id) => who.get(id)).filter(Boolean)
      .map((p) => ({ ...p!, unread: unreadBy.get(p!.id) ?? 0 }));
    return reply.send({ buddies: list(buddyIds), incoming: list(inIds), outgoing: list(outIds) });
  });

  server.get<{ Params: { slug: string } }>('/lookup/:slug', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    const p = await prisma.imProfile.findUnique({ where: { slug: req.params.slug } });
    const target = p && await prisma.user.findFirst({ where: { id: p.userId, isVerified: true }, select: { id: true, displayName: true } });
    if (!p || !target) return reply.status(404).send({ error: 'That buddy link does not lead anywhere' });
    const sysop = await sysopId();
    let relation = 'none';
    if (target.id === u.id) relation = 'self';
    else if (isAdmin(u) || target.id === sysop) relation = 'buddy';
    else {
      const row = await prisma.imBuddy.findUnique({ where: { aId_bId: pair(u.id, target.id) } });
      if (row?.status === 'accepted') relation = 'buddy';
      else if (row) relation = row.requestedBy === u.id ? 'pending-out' : 'pending-in';
    }
    return reply.send({ id: target.id, handle: handleOf(target), badges: (await badgeLookup()).forUser(target.id), avatar: avatarOf(target.id, p), relation });
  });

  server.post<{ Body: { slug?: unknown } }>('/request', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    if (requestLimiter.hit(u.id)) return reply.status(429).send({ error: 'Too many buddy requests - try again later' });
    const slug = req.body?.slug;
    if (typeof slug !== 'string') return reply.status(400).send({ error: 'slug required' });
    const p = await prisma.imProfile.findUnique({ where: { slug } });
    const target = p && await prisma.user.findFirst({ where: { id: p.userId, isVerified: true }, select: { id: true } });
    if (!p || !target) return reply.status(404).send({ error: 'That buddy link does not lead anywhere' });
    if (target.id === u.id) return reply.status(400).send({ error: 'That is your own link' });
    const sysop = await sysopId();
    if (isAdmin(u) || target.id === sysop) return reply.send({ relation: 'buddy' });
    const key = pair(u.id, target.id);
    const row = await prisma.imBuddy.findUnique({ where: { aId_bId: key } });
    if (row?.status === 'accepted') return reply.send({ relation: 'buddy' });
    if (row && row.requestedBy !== u.id) {
      // They already asked me: asking back is a yes.
      await prisma.imBuddy.update({ where: { id: row.id }, data: { status: 'accepted' } });
      return reply.send({ relation: 'buddy' });
    }
    if (row) return reply.send({ relation: 'pending-out' });
    const out = await prisma.imBuddy.count({ where: { requestedBy: u.id, status: 'pending' } });
    if (out >= MAX_PENDING_OUT) return reply.status(429).send({ error: 'Too many requests still waiting for an answer' });
    try { await prisma.imBuddy.create({ data: { ...key, requestedBy: u.id } }); } catch { /* raced: it exists now */ }
    return reply.send({ relation: 'pending-out' });
  });

  server.post<{ Body: { userId?: unknown; accept?: unknown } }>('/respond', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    const { userId, accept } = req.body ?? {};
    if (typeof userId !== 'string' || typeof accept !== 'boolean') return reply.status(400).send({ error: 'userId and accept required' });
    const row = await prisma.imBuddy.findUnique({ where: { aId_bId: pair(u.id, userId) } });
    if (!row || row.status !== 'pending' || row.requestedBy !== userId) return reply.status(404).send({ error: 'No such request' });
    if (accept) await prisma.imBuddy.update({ where: { id: row.id }, data: { status: 'accepted' } });
    else await prisma.imBuddy.delete({ where: { id: row.id } });
    return reply.send({ ok: true });
  });

  server.post<{ Body: { userId?: unknown } }>('/remove', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    const userId = req.body?.userId;
    if (typeof userId !== 'string') return reply.status(400).send({ error: 'userId required' });
    await prisma.imBuddy.deleteMany({ where: pair(u.id, userId) });
    return reply.send({ ok: true });
  });

  server.get<{ Params: { userId: string }; Querystring: { after?: string } }>('/messages/:userId', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    const other = req.params.userId;
    const sysop = await sysopId();
    const peer = (await people([other], sysop, isAdmin(u))).get(other);
    if (!peer) return reply.status(404).send({ error: 'No such user' });
    const after = req.query.after ? new Date(req.query.after) : null;
    const between = { OR: [{ fromId: u.id, toId: other }, { fromId: other, toId: u.id }] };
    const rows = after && Number.isFinite(after.getTime())
      ? await prisma.imMessage.findMany({ where: { ...between, createdAt: { gt: after } }, orderBy: { createdAt: 'asc' }, take: PAGE })
      : (await prisma.imMessage.findMany({ where: between, orderBy: { createdAt: 'desc' }, take: PAGE })).reverse();
    await prisma.imMessage.updateMany({ where: { fromId: other, toId: u.id, readAt: null }, data: { readAt: new Date() } });
    return reply.send({
      peer, canMessage: await canMessage(u, other, sysop),
      messages: rows.map((m) => ({ id: m.id, mine: m.fromId === u.id, body: m.body, at: m.createdAt.toISOString() })),
    });
  });

  server.post<{ Params: { userId: string }; Body: { body?: unknown } }>('/messages/:userId', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    const other = req.params.userId;
    const text = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!text) return reply.status(400).send({ error: 'Empty message' });
    if (text.length > MAX_BODY) return reply.status(400).send({ error: `Messages are at most ${MAX_BODY} characters` });
    if (sendLimiter.hit(u.id)) return reply.status(429).send({ error: 'Slow down a little' });
    const sysop = await sysopId();
    if (other === u.id) return reply.status(400).send({ error: 'That is you' });
    const target = await prisma.user.findFirst({ where: { id: other, isVerified: true }, select: { id: true } });
    if (!target) return reply.status(404).send({ error: 'No such user' });
    if (!(await canMessage(u, other, sysop))) return reply.status(403).send({ error: 'You can only message your buddies' });
    const m = await prisma.imMessage.create({ data: { fromId: u.id, toId: other, body: text } });
    return reply.send({ message: { id: m.id, mine: true, body: m.body, at: m.createdAt.toISOString() } });
  });

  server.get('/unread', async (req, reply) => {
    const u = await me(req, reply); if (!u) return;
    return reply.send({ total: await prisma.imMessage.count({ where: { toId: u.id, readAt: null } }) });
  });
}
