import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';
import { getUser } from './user';
import { isAdmin } from '../lib/admin';

/**
 * Moderation (sysop only): a plain account list and a freeze switch. Badges are
 * granted through /api/badges/admin. Deliberately thin: no addresses, IPs,
 * sessions or activity, and nothing that deletes or rewrites an account.
 *
 *   GET  /api/moderation/users?q=      -> { users: [{ id, handle, verified, frozen, joined, badges }] }
 *   POST /api/moderation/users/:id/freeze  body { frozen: boolean } -> { ok }
 *
 * A frozen account ('all') is shut out everywhere at once: getUser refuses it.
 */

async function requireSysop(req: FastifyRequest) {
  const user = await getUser(req);
  return user && user.isVerified && isAdmin(user) ? user : null;
}

export async function moderationRoutes(server: FastifyInstance) {
  server.get('/users', async (req, reply) => {
    if (!(await requireSysop(req))) return reply.code(403).send({ error: 'Sysop only' });
    const q = String(((req.query ?? {}) as Record<string, unknown>).q ?? '').trim().slice(0, 40);
    const rows = await prisma.user.findMany({
      where: { deletedAt: null, ...(q ? { displayName: { contains: q, mode: 'insensitive' as const } } : {}) },
      orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, displayName: true, isVerified: true, frozen: true, createdAt: true, badges: { select: { badge: { select: { key: true } } } } },
    });
    return {
      users: rows.map((u) => ({
        id: u.id, handle: u.displayName, verified: u.isVerified, frozen: Boolean(u.frozen), joined: u.createdAt,
        badges: u.badges.map((b) => b.badge.key),
      })),
    };
  });

  server.post<{ Params: { id: string }; Body: { frozen?: boolean } }>('/users/:id/freeze', async (req, reply) => {
    const me = await requireSysop(req);
    if (!me) return reply.code(403).send({ error: 'Sysop only' });
    if (typeof req.body?.frozen !== 'boolean') return reply.code(400).send({ error: 'frozen must be true or false' });
    if (req.params.id === me.id) return reply.code(400).send({ error: 'You cannot freeze yourself' });
    const { count } = await prisma.user.updateMany({ where: { id: req.params.id, deletedAt: null }, data: { frozen: req.body.frozen ? 'all' : null } });
    if (!count) return reply.code(404).send({ error: 'No such account' });
    server.log.info({ sysop: me.displayName, id: req.params.id, frozen: req.body.frozen }, '[moderation] account frozen state changed');
    return { ok: true };
  });
}
