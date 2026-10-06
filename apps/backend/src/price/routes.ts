import type { FastifyInstance } from 'fastify';
import { getSpotPrice } from './oracle';

export async function priceRoutes(server: FastifyInstance) {
  // GET /api/price - current ZEC/USD as the median of live exchange tickers.
  server.get('/', async (_req, reply) => {
    try {
      const price = await getSpotPrice();
      // Short cache header; the oracle also caches in-process.
      reply.header('Cache-Control', 'public, max-age=30');
      return reply.send(price);
    } catch (e: any) {
      return reply.status(503).send({ error: e?.message ?? 'Price temporarily unavailable' });
    }
  });
}
