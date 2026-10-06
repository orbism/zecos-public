import type { FastifyInstance } from 'fastify';
import { clientIp } from '../api/user';
import { isLocalCaller } from './proxyAuth';
import { rateLimiter } from './ratelimit';

/*
 * A per-address ceiling for every request, and a much lower one for the public
 * reads that do real work (audit M9): the registry Merkle root, the log, per-
 * Pool proofs, the full browse. There was no global limit at all, so one
 * script could keep those running back to back.
 *
 * Keyed on the browser's address as clientIp resolves it. A request with no
 * address (the proxy talking for itself) and a genuinely local caller (the
 * wallet manager, curl on the box) are not limited - otherwise every visitor
 * behind the proxy would share one bucket.
 */
const general = rateLimiter({ windowMs: 60_000, max: Math.max(1, parseInt(process.env.RATE_LIMIT_PER_MIN ?? '', 10) || 600) });
const heavy = rateLimiter({ windowMs: 60_000, max: Math.max(1, parseInt(process.env.RATE_LIMIT_HEAVY_PER_MIN ?? '', 10) || 60) });
const HEAVY = [
  /^\/api\/rings\/anchor\/verify/, /^\/api\/rings\/log(\/|\?|$)/, /^\/api\/rings\/[^/]+\/proofs/,
  /^\/api\/rings\/registry/, /^\/api\/rings\/zsa\//, /^\/api\/market(\?|$)/, /^\/api\/rings\/traffic/,
];

export function registerRequestLimit(server: FastifyInstance): void {
  server.addHook('onRequest', async (req, reply) => {
    if (isLocalCaller(req)) return;
    const ip = clientIp(req, { quiet: true });
    if (!ip) return;
    const isHeavy = req.method === 'GET' && HEAVY.some((r) => r.test(req.url));
    if (general.hit(ip) || (isHeavy && heavy.hit(ip))) {
      reply.header('Retry-After', '60');
      return reply.code(429).send({ error: 'Too many requests - try again in a minute.' });
    }
  });
}
