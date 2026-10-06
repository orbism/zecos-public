import type { FastifyInstance } from 'fastify';
import { getUser } from './user';
import { isAdmin } from '../lib/admin';
import { getRegistration, setRegistration } from '../lib/registration';

/**
 * The new-registration switch.
 *
 *   GET  /api/registration         public  -> { open, reopensAt, message }
 *   POST /api/registration/admin   sysop   body { open: boolean, reopensAt?: ISO | null, message?: string | null }
 *
 * Only the sysop's verified session can flip it. The one other way is the
 * operator's shell: `node tools/registration.mjs`, which needs the database.
 */

const MAX_AHEAD_MS = 366 * 24 * 3600 * 1000, MAX_MESSAGE = 400;

export async function registrationRoutes(server: FastifyInstance) {
  server.get('/', async (_req, reply) => reply.send(await getRegistration()));

  server.post<{ Body: { open?: unknown; reopensAt?: unknown; message?: unknown } }>('/admin', async (req, reply) => {
    const user = await getUser(req);
    if (!user || !user.isVerified || !isAdmin(user)) return reply.status(403).send({ error: 'Sysop only' });

    const { open, reopensAt, message } = req.body ?? {};
    if (typeof open !== 'boolean') return reply.status(400).send({ error: 'open must be true or false' });
    if (message != null && typeof message !== 'string') return reply.status(400).send({ error: 'message must be text' });
    const note = typeof message === 'string' ? message.replace(/\s+/g, ' ').trim() || null : null;
    if (note && note.length > MAX_MESSAGE) return reply.status(400).send({ error: `message is over ${MAX_MESSAGE} characters` });

    let when: Date | null = null;
    if (!open && reopensAt !== undefined && reopensAt !== null && reopensAt !== '') {
      if (typeof reopensAt !== 'string') return reply.status(400).send({ error: 'reopensAt must be an ISO date' });
      when = new Date(reopensAt);
      const t = when.getTime();
      if (!Number.isFinite(t)) return reply.status(400).send({ error: 'reopensAt is not a date' });
      if (t <= Date.now()) return reply.status(400).send({ error: 'reopensAt is in the past' });
      if (t > Date.now() + MAX_AHEAD_MS) return reply.status(400).send({ error: 'reopensAt is more than a year away' });
    }

    const by = user.displayName ?? `${(user.address ?? '').slice(0, 10)}…`;
    const next = await setRegistration(open, when, note, by);
    server.log.info(`[registration] ${open ? 'opened' : 'closed'} by ${by}${when ? ` until ${when.toISOString()}` : ''}`);
    return reply.send(next);
  });
}
