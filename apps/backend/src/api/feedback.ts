import { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { getUser, clientIp } from './user';
import { isAdmin as isAdminUser } from '../lib/admin';

// Public feedback inbox: anyone (guest or verified) can send one short note.
// The sysop reads them from a taskbar bell. Deliberately small - no threading,
// no replies, no email delivery.

const TOPICS = ['suggestion', 'bug', 'collab', 'other'] as const;
type Topic = (typeof TOPICS)[number];

const MAX_BODY = 500;
const MAX_CONTACT = 120;

// ── Human check ──────────────────────────────────────────────────────────────
// Server-issued, single-use, in-memory. The point is not to stop a determined
// human - it's to make drive-by form spam cost more than it's worth, which the
// timing floor and the per-IP caps below do most of the work for.

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MIN_FILL_MS = 4_000;   // nobody reads the form and types 500 chars faster
const challenges = new Map<string, { answer: string; issuedAt: number }>();

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const QUESTIONS: (() => { question: string; answer: string })[] = [
  () => {
    const words = ['orchard', 'sapling', 'ironwood', 'espresso'];
    return { question: `Which one of these is NOT a Zcash pool: ${words.join(', ')}?`, answer: 'espresso' };
  },
  () => ({ question: 'Type the word ZCASH backwards.', answer: 'hsacz' }),
  () => ({ question: "How many letters are in the word 'shielded'?", answer: '8' }),
  () => ({ question: "What is the third word in 'keep your coins private'?", answer: 'coins' }),
  () => ({ question: 'Two plus three equals what? (digits, please)', answer: '5' }),
  () => ({ question: 'Which is warmer: coffee, or a cold wallet? (one word)', answer: 'coffee' }),
  () => ({ question: 'Which of these starts a Zcash unified address: u1, 0x, or bc1?', answer: 'u1' }),
  () => ({ question: 'Ten minus four equals what? (digits, please)', answer: '6' }),
];

function issueChallenge(): { id: string; question: string } {
  const { question, answer } = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)]();
  const id = crypto.randomBytes(12).toString('hex');
  challenges.set(id, { answer: norm(answer), issuedAt: Date.now() });
  // Opportunistic sweep - this map only ever holds a handful of entries.
  const cutoff = Date.now() - CHALLENGE_TTL_MS;
  for (const [k, v] of challenges) if (v.issuedAt < cutoff) challenges.delete(k);
  return { id, question };
}

/**
 * Grades the challenge. A wrong or expired answer spends it - a *too fast* one
 * does not, because that's a real person who swapped to an easier question and
 * typed quickly, and making them redo a fresh puzzle for it would be obnoxious.
 * `keep` tells the client whether the challenge it holds is still usable.
 */
function checkChallenge(id: string, answer: string): { error: string; keep: boolean } | null {
  const c = challenges.get(id);
  if (!c) return { error: 'That human check expired. Grab a fresh one and try again.', keep: false };
  if (Date.now() - c.issuedAt > CHALLENGE_TTL_MS) {
    challenges.delete(id);
    return { error: 'That human check expired. Try again.', keep: false };
  }
  if (Date.now() - c.issuedAt < MIN_FILL_MS)
    return { error: 'Whoa there, speedy. Take a breath and hit send again.', keep: true };
  challenges.delete(id);
  if (norm(answer) !== c.answer) return { error: "That's not it. Have another go.", keep: false };
  return null;
}

// ── Per-IP caps ──────────────────────────────────────────────────────────────
const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 3;
const sends = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (sends.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
  if (hits.length >= MAX_PER_HOUR) { sends.set(ip, hits); return true; }
  hits.push(now);
  sends.set(ip, hits);
  if (sends.size > 5000) for (const [k, v] of sends) if (!v.some((t) => now - t < HOUR_MS)) sends.delete(k);
  return false;
}

// ── Admin ────────────────────────────────────────────────────────────────────
// Admin is the ADMIN_ADDRESS account, never a display name - see lib/admin.
function isAdmin(user: { address?: string | null } | null): boolean { return isAdminUser(user); }
async function requireAdmin(req: FastifyRequest) {
  const u = await getUser(req);
  return u && u.isVerified && isAdmin(u) ? u : null;
}

function clean(v: unknown, max: number): string | null {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
}

export async function feedbackRoutes(server: FastifyInstance) {
  // Public: fetch a human check to attach to a submission.
  server.get('/challenge', async (_req, reply) => reply.send(issueChallenge()));

  // Public: submit.
  server.post<{
    Body: {
      challengeId?: string; answer?: string; topic?: string; body?: string;
      email?: string; discord?: string; twitter?: string;
    };
  }>('/', async (req, reply) => {
    const b = req.body ?? {};
    const ip = clientIp(req) || 'unknown';

    const challengeError = checkChallenge((b.challengeId ?? '').trim(), b.answer ?? '');
    if (challengeError)
      return reply.status(400).send({ error: challengeError.error, keepChallenge: challengeError.keep });

    if (rateLimited(ip))
      return reply.status(429).send({ error: "You've sent a few already - give it an hour, we're reading." });

    const topic = (TOPICS as readonly string[]).includes(b.topic ?? '') ? (b.topic as Topic) : 'other';
    const body = (b.body ?? '').trim();
    if (!body) return reply.status(400).send({ error: 'Say something first.' });
    if (body.length > MAX_BODY) return reply.status(400).send({ error: `Keep it under ${MAX_BODY} characters.` });

    // Optional - a sender may stay entirely anonymous.
    const user = await getUser(req).catch(() => null);

    try {
      await prisma.feedback.create({
        data: {
          topic, body,
          email: clean(b.email, MAX_CONTACT),
          discord: clean(b.discord, MAX_CONTACT),
          twitter: clean(b.twitter, MAX_CONTACT),
          handle: user?.displayName ?? null,
          userId: user?.id ?? null,
          ip,
          userAgent: clean(req.headers['user-agent'], 200),
        },
      });
    } catch (e) {
      // Almost always one of two things: the Feedback table hasn't been pushed
      // yet, or the generated Prisma client predates the model. Say so in the
      // log rather than leaking a bare 500 to the sender.
      server.log.error({ err: e }, 'feedback insert failed');
      const missingModel = !(prisma as { feedback?: unknown }).feedback;
      return reply.status(503).send({
        error: missingModel
          ? 'Feedback storage is not set up on this server yet.'
          : 'Could not save that - the sysop has been handed a stack trace.',
      });
    }

    return reply.send({ ok: true });
  });

  // ── Sysop ──────────────────────────────────────────────────────────────────
  server.get('/admin/list', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    const tickets = await prisma.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const unread = await prisma.feedback.count({ where: { readAt: null } });
    const open = await prisma.feedback.count({ where: { resolvedAt: null } });
    return reply.send({ tickets, unread, open });
  });

  // Cheap poll for the notification bell - no ticket bodies, just the counts.
  server.get('/admin/count', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    const unread = await prisma.feedback.count({ where: { readAt: null } });
    return reply.send({ unread });
  });

  server.post<{ Body: { id?: string; all?: boolean } }>('/admin/read', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    const now = new Date();
    if (req.body?.all) await prisma.feedback.updateMany({ where: { readAt: null }, data: { readAt: now } });
    else if (req.body?.id) await prisma.feedback.updateMany({ where: { id: req.body.id, readAt: null }, data: { readAt: now } });
    else return reply.status(400).send({ error: 'id or all required' });
    return reply.send({ ok: true });
  });

  server.post<{ Body: { id?: string; resolved?: boolean } }>('/admin/resolve', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    const id = (req.body?.id ?? '').trim();
    if (!id) return reply.status(400).send({ error: 'id required' });
    const resolved = req.body?.resolved !== false;
    // Resolving also counts as reading it.
    await prisma.feedback.update({
      where: { id },
      data: { resolvedAt: resolved ? new Date() : null, ...(resolved ? { readAt: new Date() } : {}) },
    });
    return reply.send({ ok: true });
  });
}
