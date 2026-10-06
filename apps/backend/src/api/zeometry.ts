import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';
import { getUser } from './user';
import { badgeLookup } from '../lib/badges';

/**
 * Zeometry Wars leaderboards: solo, co-op and versus, this week and all time.
 * Verified accounts post; anyone reads.
 *
 * Runs come from the player's browser (online play is browser to browser over
 * WebRTC), so they can be forged by someone determined. The checks below
 * refuse any run its own numbers can't explain: the score against the kills
 * and the multiplier, the multiplier against the notes collected, the wave and
 * the kill count against the time played.
 *
 * Co-op and versus are posted by the host alone. The host is always the poster
 * (taken from the session, never the body); other players must be verified
 * handles, so a team row can't carry a name its owner never played under.
 * Co-op keeps one row per team (sorted handles), versus one row per poster.
 */

const MODES = ['solo', 'coop', 'versus'] as const;
type Mode = (typeof MODES)[number];
const POINTS: Record<string, number> = { tracker: 50, dust: 100, doxxer: 100, shard: 50, reuse: 150, analyst: 200, deanon: 250 };
const MIN_POST_GAP_MS = 20_000;
const MAX_PLAYERS = 4;
/** Postgres Int is 32-bit; nothing legitimate comes near it. */
const MAX_SCORE = 2_000_000_000;
const BAD = { error: 'That run does not add up.' };

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
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const modeOf = (v: unknown): Mode | null => (MODES.includes(v as Mode) ? (v as Mode) : null);

export async function zeometryRoutes(server: FastifyInstance) {
  /** Post a finished run. Answers its place on this week's board, or null if it isn't the best. */
  server.post('/runs', async (req, reply) => {
    const user = await requireVerified(req);
    // getUser already refuses unverified and frozen accounts, so this is 401 for both, as in ZOOM.
    if (!user) return reply.code(401).send({ error: 'sign in with a verified account to post Zeometry scores' });
    if (!user.displayName || !user.nameKey) return reply.code(403).send({ error: 'set a display name to post Zeometry scores' });

    const b = (req.body ?? {}) as Record<string, unknown>;
    const mode = modeOf(b.mode);
    const kills = (b.kills && typeof b.kills === 'object' ? b.kills : {}) as Record<string, unknown>;
    const nums = [b.score, b.wave, b.seconds, b.notes, b.bombs, b.peakMult];
    if (!mode || !nums.every(isInt) || !Object.values(kills).every(isInt) || Object.keys(kills).some((k) => !(k in POINTS))) return reply.code(422).send(BAD);
    const [score, wave, seconds, notes, , peakMult] = nums as number[];
    const killPoints = Object.entries(kills).reduce((a, [k, n]) => a + POINTS[k] * (n as number), 0);
    const killCount = Object.values(kills).reduce<number>((a, n) => a + (n as number), 0);
    const adds = score <= MAX_SCORE
      && score <= killPoints * Math.max(1, peakMult)
      && peakMult <= Math.min(150, notes + 1)
      && wave <= seconds / 30 + 1
      && killCount <= seconds * 12
      && seconds <= 24 * 3600;
    if (!adds) return reply.code(422).send(BAD);

    const last = await prisma.zeometryRun.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (last && Date.now() - last.createdAt.getTime() < MIN_POST_GAP_MS) return reply.code(429).send({ error: 'one run every 20 seconds' });

    // The team: the poster first, then the other players that are verified accounts.
    let members = [{ key: user.nameKey, name: user.displayName }];
    if (mode !== 'solo' && Array.isArray(b.players)) {
      const want = [...new Set(b.players.filter((p): p is string => typeof p === 'string').map((p) => p.trim().toLowerCase()).filter((k) => k && k !== user.nameKey))].slice(0, MAX_PLAYERS - 1);
      const found = want.length ? await prisma.user.findMany({ where: { nameKey: { in: want }, isVerified: true }, select: { nameKey: true, displayName: true } }) : [];
      members = members.concat(want.map((k) => found.find((f) => f.nameKey === k)).filter((f): f is { nameKey: string; displayName: string } => !!f?.nameKey && !!f.displayName).map((f) => ({ key: f.nameKey, name: f.displayName })));
    }
    const teamKey = mode === 'coop' ? members.map((m) => m.key).sort().join('+') : user.id;
    const names = mode === 'coop' ? members.map((m) => m.name).join(' + ') : user.displayName;
    const ship = typeof b.ship === 'string' ? b.ship.replace(/[^\w-]/g, '').slice(0, 24) || 'ship' : 'ship';
    const run = await prisma.zeometryRun.create({ data: { userId: user.id, mode, teamKey, names, score, wave, ship, seconds } });

    // Only a player's (or team's) best run of the week has a place on the board.
    const since = weekStart();
    const better = await prisma.zeometryRun.findFirst({
      where: { mode, teamKey, createdAt: { gte: since }, id: { not: run.id }, score: { gte: score } }, select: { id: true },
    });
    if (better) return { rank: null };
    const ahead = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM (
        SELECT "teamKey", MAX(score) AS best FROM "ZeometryRun"
        WHERE mode = ${mode} AND "createdAt" >= ${since} AND "teamKey" <> ${teamKey}
        GROUP BY "teamKey"
      ) t WHERE best > ${score}`;
    return { rank: (ahead[0]?.n ?? 0) + 1 };
  });

  /** Top 10 for a mode, this week or all time: each player's (or team's) best run. */
  server.get('/board', async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const mode = modeOf(q.mode) ?? 'solo';
    const week = q.period !== 'all';
    const since = week ? weekStart() : new Date(0);
    // Best run per team key; ties go to whoever got there first.
    const best = await prisma.$queryRaw<{ id: string; userId: string; teamKey: string; names: string; score: number; wave: number; ship: string }[]>`
      SELECT * FROM (
        SELECT DISTINCT ON ("teamKey") id, "userId", "teamKey", names, score, wave, ship, "createdAt"
        FROM "ZeometryRun" WHERE mode = ${mode} AND "createdAt" >= ${since}
        ORDER BY "teamKey", score DESC, "createdAt" ASC
      ) b ORDER BY score DESC, "createdAt" ASC LIMIT 10`;
    const bl = await badgeLookup();
    const me = await getUser(req).catch(() => null);
    return {
      rows: best.map((r, i) => {
        const team = mode === 'coop' ? r.teamKey.split('+') : null;
        const badges = team ? [...new Set(r.names.split(' + ').flatMap((n) => bl.forName(n)))] : bl.forUser(r.userId);
        const mine = !!me && (team ? !!me.nameKey && team.includes(me.nameKey) : me.id === r.userId);
        return { rank: i + 1, name: r.names, badges, score: r.score, wave: r.wave, ship: r.ship, mine };
      }),
    };
  });
}
