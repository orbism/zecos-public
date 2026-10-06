import { FastifyInstance, FastifyRequest } from 'fastify';
import { getUser } from './user';
import { isAdmin as isAdminUser } from '../lib/admin';
import { bump, version, waitForSignal } from '../lib/longpoll';

// System-wide broadcast: the sysop posts a message; every connected client
// long-polls this and shows it as a big orange modal. In-memory, ephemeral.

const TOPIC = 'broadcast';
const HOLD_MS = 25_000;
let current: { seq: number; body: string; at: number } | null = null;

// Admin is the ADMIN_ADDRESS account, never a display name - see lib/admin.
function isAdmin(user: { address?: string | null } | null): boolean { return isAdminUser(user); }
async function requireAdmin(req: FastifyRequest) {
  const u = await getUser(req);
  return u && u.isVerified && isAdmin(u) ? u : null;
}

export async function broadcastRoutes(server: FastifyInstance) {
  // Public long-poll - every client (verified or guest) watches this.
  server.get<{ Querystring: { v?: string } }>('/', async (req, reply) => {
    const clientV = Number(req.query?.v ?? -1);
    if (clientV >= 0 && version(TOPIC) === clientV) await waitForSignal(TOPIC, HOLD_MS);
    return reply.send({ v: version(TOPIC), broadcast: current });
  });

  server.post<{ Body: { body: string } }>('/admin', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    const body = (req.body?.body ?? '').trim().slice(0, 500);
    if (!body) return reply.status(400).send({ error: 'Empty broadcast' });
    current = { seq: (current?.seq ?? 0) + 1, body, at: Date.now() };
    bump(TOPIC);
    return reply.send({ ok: true, seq: current.seq });
  });

  server.post('/admin/clear', async (req, reply) => {
    if (!(await requireAdmin(req))) return reply.status(403).send({ error: 'Sysop only' });
    current = null;
    bump(TOPIC);
    return reply.send({ ok: true });
  });
}
