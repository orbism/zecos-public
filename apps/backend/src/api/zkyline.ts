import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';
import { getUser } from './user';
import { badgeLookup } from '../lib/badges';

/**
 * Zkyline leaderboards: time survived, this week and all time. Verified
 * accounts post; anyone reads.
 *
 *   POST /api/zkyline/start          verified  -> { runId }
 *   POST /api/zkyline/finish         verified  body { runId, tenths, seed? } -> { tenths, best, newBest, rank }
 *   GET  /api/zkyline/board?period=week|all   -> { rows }
 *
 * The score is time, so the server times it: a run opens on /start and the
 * claimed time can never be more than the time the server saw pass between
 * /start and /finish (plus a little slack for the network). A client can still
 * idle a run out by hand, but it cannot invent time.
 */

const MIN_START_GAP_MS = 2_000;
const SLACK_TENTHS = 20;
/** Three hours: anything longer is a tab left open, not a run. */
const MAX_TENTHS = 3 * 60 * 60 * 10;
const OPEN_FOR_MS = MAX_TENTHS * 100 + 60_000;

async function requireVerified(req: FastifyRequest) {
  const user = await getUser(req);
  return user && user.isVerified && !user.frozen ? user : null;
}
/** Monday 00:00 UTC of the current week. */
function weekStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

export async function zkylineRoutes(server: FastifyInstance) {
  server.post('/start', async (req, reply) => {
    const user = await requireVerified(req);
    if (!user) return reply.code(401).send({ error: 'verify an account to post Zkyline times' });
    const last = await prisma.zkylineRun.findFirst({ where: { userId: user.id }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } });
    if (last && Date.now() - last.startedAt.getTime() < MIN_START_GAP_MS) return reply.code(429).send({ error: 'slow down' });
    // Runs never finished (a closed tab) are only noise after a day.
    await prisma.zkylineRun.deleteMany({ where: { userId: user.id, finishedAt: null, startedAt: { lt: new Date(Date.now() - 864e5) } } });
    const run = await prisma.zkylineRun.create({ data: { userId: user.id }, select: { id: true } });
    return { runId: run.id };
  });

  server.post('/finish', async (req, reply) => {
    const user = await requireVerified(req);
    if (!user) return reply.code(401).send({ error: 'verify an account to post Zkyline times' });
    if (!user.displayName) return reply.code(403).send({ error: 'set a display name to post Zkyline times' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const tenths = b.tenths, runId = b.runId;
    if (typeof runId !== 'string' || typeof tenths !== 'number' || !Number.isInteger(tenths) || tenths < 0 || tenths > MAX_TENTHS) {
      return reply.code(422).send({ error: 'that run does not add up' });
    }
    const run = await prisma.zkylineRun.findUnique({ where: { id: runId } });
    if (!run || run.userId !== user.id || run.finishedAt) return reply.code(404).send({ error: 'no open run' });
    const now = Date.now();
    const seen = Math.floor((now - run.startedAt.getTime()) / 100);
    if (now - run.startedAt.getTime() > OPEN_FOR_MS) return reply.code(410).send({ error: 'that run timed out' });
    if (tenths > seen + SLACK_TENTHS) return reply.code(422).send({ error: 'that run is longer than the time that passed' });
    const seed = typeof b.seed === 'number' && Number.isInteger(b.seed) ? b.seed | 0 : null;
    const closed = await prisma.zkylineRun.updateMany({ where: { id: run.id, finishedAt: null }, data: { finishedAt: new Date(now), tenths: Math.min(tenths, seen), seed } });
    if (closed.count !== 1) return reply.code(404).send({ error: 'no open run' });
    const score = Math.min(tenths, seen);
    const [best] = await prisma.$queryRaw<{ best: number | null }[]>`SELECT MAX(tenths)::int AS best FROM "ZkylineRun" WHERE "userId" = ${user.id} AND "finishedAt" IS NOT NULL AND "finishedAt" >= ${weekStart().toISOString()}::timestamp`;
    const wk = best?.best ?? score;
    const [r] = await prisma.$queryRaw<{ ahead: number }[]>`
      SELECT COUNT(*)::int AS ahead FROM (
        SELECT "userId", MAX(tenths) AS b FROM "ZkylineRun"
        WHERE "finishedAt" IS NOT NULL AND "finishedAt" >= ${weekStart().toISOString()}::timestamp GROUP BY "userId"
      ) x WHERE x.b > ${wk}`;
    return { tenths: score, best: wk, newBest: score >= wk, rank: (r?.ahead ?? 0) + 1 };
  });

  server.get('/board', async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const period = q.period === 'all' ? 'all' : 'week';
    const since = period === 'week' ? weekStart() : new Date(0);
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
    const rows = await prisma.$queryRaw<{ userId: string; tenths: number; at: Date }[]>`
      SELECT DISTINCT ON ("userId") "userId", tenths, "finishedAt" AS at FROM "ZkylineRun"
      WHERE "finishedAt" IS NOT NULL AND tenths IS NOT NULL AND "finishedAt" >= ${since.toISOString()}::timestamp
      ORDER BY "userId", tenths DESC, "finishedAt" ASC`;
    rows.sort((a, b) => b.tenths - a.tenths || a.at.getTime() - b.at.getTime());
    const top = rows.slice(0, limit);
    const users = await prisma.user.findMany({ where: { id: { in: top.map((r) => r.userId) } }, select: { id: true, displayName: true } });
    const name = new Map(users.map((u) => [u.id, u.displayName]));
    const bl = await badgeLookup();
    const me = await getUser(req).catch(() => null);
    return {
      period,
      rows: top.map((r, i) => ({ rank: i + 1, name: name.get(r.userId) || 'anonymous', badges: bl.forUser(r.userId), mine: me?.id === r.userId, tenths: r.tenths, at: r.at })),
    };
  });
}
