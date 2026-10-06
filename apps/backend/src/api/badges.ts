import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { isAdmin } from '../lib/admin';
import { getUser } from './user';
import { badgeDefs, invalidateBadges, BADGE_IMAGE_RE, MAX_BADGE_IMAGE } from '../lib/badges';

/**
 * GET /api/badges        every badge's image, title and tooltip (public; payloads carry keys only)
 * /api/badges/admin/...  sysop: define, edit, delete, grant, revoke
 */

const TITLE_RE = /^[A-Za-z0-9]{1,16}$/;
const MAX_TOOLTIP = 120;

function checkFields(b: { title?: unknown; tooltip?: unknown; image?: unknown }, partial: boolean): string | null {
  if ((!partial || b.title !== undefined) && !(typeof b.title === 'string' && TITLE_RE.test(b.title)))
    return 'Title: one word, letters and digits, up to 16';
  if ((!partial || b.tooltip !== undefined) && !(typeof b.tooltip === 'string' && b.tooltip.trim() && b.tooltip.length <= MAX_TOOLTIP))
    return `Tooltip: 1 to ${MAX_TOOLTIP} characters`;
  if ((!partial || b.image !== undefined) && !(typeof b.image === 'string' && BADGE_IMAGE_RE.test(b.image) && b.image.length <= MAX_BADGE_IMAGE))
    return 'Image: a PNG, WebP or SVG under about 45KB';
  return null;
}

export async function badgeRoutes(server: FastifyInstance) {
  server.get('/', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return { badges: (await badgeDefs()).map(({ key, title, tooltip, image }) => ({ key, title, tooltip, image })) };
  });

  const sysop = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await getUser(req);
    if (!isAdmin(user)) { reply.status(403).send({ error: 'Sysop only' }); return null; }
    return user;
  };
  const done = () => { invalidateBadges(); return { ok: true }; };

  server.get('/admin', async (req, reply) => {
    if (!(await sysop(req, reply))) return;
    const rows = await prisma.badge.findMany({
      orderBy: { createdAt: 'asc' },
      include: { holders: { orderBy: { grantedAt: 'asc' }, select: { userId: true, grantedAt: true, user: { select: { displayName: true } } } } },
    });
    return {
      badges: rows.map((b) => ({
        key: b.key, title: b.title, tooltip: b.tooltip, image: b.imageData, locked: b.locked,
        holders: b.holders.map((h) => ({ userId: h.userId, name: h.user.displayName, grantedAt: h.grantedAt })),
      })),
    };
  });

  server.post<{ Body: { title?: string; tooltip?: string; image?: string } }>('/admin', async (req, reply) => {
    if (!(await sysop(req, reply))) return;
    const b = req.body ?? {};
    const bad = checkFields(b, false);
    if (bad) return reply.status(400).send({ error: bad });
    try {
      await prisma.badge.create({ data: { title: b.title!, key: b.title!.toLowerCase(), tooltip: b.tooltip!.trim(), imageData: b.image! } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return reply.status(409).send({ error: 'A badge with that title exists' });
      throw e;
    }
    return done();
  });

  server.put<{ Params: { key: string }; Body: { title?: string; tooltip?: string; image?: string } }>('/admin/:key', async (req, reply) => {
    if (!(await sysop(req, reply))) return;
    const b = req.body ?? {};
    const bad = checkFields(b, true);
    if (bad) return reply.status(400).send({ error: bad });
    const n = await prisma.badge.updateMany({
      where: { key: req.params.key },
      data: { ...(b.title ? { title: b.title } : {}), ...(b.tooltip ? { tooltip: b.tooltip.trim() } : {}), ...(b.image ? { imageData: b.image } : {}) },
    });
    if (!n.count) return reply.status(404).send({ error: 'No such badge' });
    return done();
  });

  server.delete<{ Params: { key: string } }>('/admin/:key', async (req, reply) => {
    if (!(await sysop(req, reply))) return;
    const n = await prisma.badge.deleteMany({ where: { key: req.params.key, locked: false } });
    if (!n.count) return reply.status(400).send({ error: 'No such badge, or it cannot be deleted' });
    return done();
  });

  const holder = (grant: boolean) => async (req: FastifyRequest<{ Params: { key: string }; Body: { userId?: string } }>, reply: FastifyReply) => {
    if (!(await sysop(req, reply))) return;
    const userId = String(req.body?.userId ?? '');
    const badge = await prisma.badge.findUnique({ where: { key: req.params.key }, select: { id: true } });
    if (!badge || !userId) return reply.status(404).send({ error: 'No such badge or user' });
    if (grant) {
      if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) return reply.status(404).send({ error: 'No such user' });
      await prisma.userBadge.upsert({ where: { userId_badgeId: { userId, badgeId: badge.id } }, create: { userId, badgeId: badge.id }, update: {} });
    } else {
      await prisma.userBadge.deleteMany({ where: { userId, badgeId: badge.id } });
    }
    return done();
  };
  server.post('/admin/:key/grant', holder(true));
  server.post('/admin/:key/revoke', holder(false));
}
