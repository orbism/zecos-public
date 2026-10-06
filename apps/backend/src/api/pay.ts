import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getUser } from './user';

/**
 * Pay Me pages: one per verified account, at zec-os.com/pay/<handle>.
 *
 *   GET /api/pay/me          verified -> { page | null, handle }
 *   PUT /api/pay/me          verified body { address, title?, bio?, amounts?, memoHint?, enabled? } -> { page, handle }
 *   GET /api/pay/:handle     public   -> { page, handle, name } (enabled pages of verified, unfrozen accounts only)
 *
 * The handle is the account's own name (User.nameKey), looked up at read
 * time, so a rename carries over. ZEC-OS only stores where to send and what
 * to show: the frontend builds the payment request, and nothing here watches
 * for payments.
 */

// Mainnet receiving addresses: transparent (t1/t3), Sapling (zs1) or unified (u1).
const ADDRESS = /^(t1|t3)[1-9A-HJ-NP-Za-km-z]{33}$|^zs1[02-9ac-hj-np-z]{75}$|^u1[02-9ac-hj-np-z]{100,}$/;
const AMOUNT = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,8})?$/;

const str = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
};

const SHOW = { address: true, title: true, bio: true, amounts: true, memoHint: true, enabled: true, updatedAt: true } as const;

export async function payRoutes(server: FastifyInstance) {
  server.get('/me', async (req, reply) => {
    const user = await getUser(req);
    if (!user || !user.isVerified) return reply.status(401).send({ error: 'Verified accounts only.' });
    const page = await prisma.payPage.findUnique({ where: { userId: user.id }, select: SHOW });
    return reply.send({ page, handle: user.nameKey });
  });

  server.put<{ Body: Record<string, unknown> }>('/me', async (req, reply) => {
    const user = await getUser(req);
    if (!user || !user.isVerified) return reply.status(401).send({ error: 'Verified accounts only.' });
    if (!user.nameKey) return reply.status(400).send({ error: 'Pick a display name first: it becomes your page address.' });
    const b = req.body ?? {};
    const address = str(b.address, 600);
    if (!address || !ADDRESS.test(address)) return reply.status(400).send({ error: 'That is not a mainnet t1, t3, zs1 or u1 address.' });
    const amounts = Array.isArray(b.amounts)
      ? b.amounts.map((a) => String(a).trim()).filter((a) => AMOUNT.test(a) && Number(a) > 0).slice(0, 6)
      : [];
    const data = {
      address,
      title: str(b.title, 60),
      bio: str(b.bio, 300),
      amounts,
      memoHint: str(b.memoHint, 80),
      enabled: typeof b.enabled === 'boolean' ? b.enabled : true,
    };
    const page = await prisma.payPage.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data, select: SHOW });
    return reply.send({ page, handle: user.nameKey });
  });

  server.get<{ Params: { handle: string } }>('/:handle', async (req, reply) => {
    const key = req.params.handle.toLowerCase().slice(0, 40);
    const user = await prisma.user.findUnique({ where: { nameKey: key }, select: { id: true, displayName: true, isVerified: true, frozen: true, deletedAt: true } });
    if (!user || !user.isVerified || user.frozen || user.deletedAt) return reply.status(404).send({ error: 'No page here.' });
    const page = await prisma.payPage.findUnique({ where: { userId: user.id }, select: SHOW });
    if (!page || !page.enabled) return reply.status(404).send({ error: 'No page here.' });
    return reply.send({ page, handle: key, name: user.displayName });
  });
}
