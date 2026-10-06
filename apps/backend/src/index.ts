import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './api/routes';
import { startPaymentWatcher } from './payment/watcher';
import { startAuthReconciler } from './api/auth';
import { backfillNameKeys, explainAdmin } from './lib/admin';
import { backfillUserAddresses } from './lib/userAddress';
import { allowedNetworks } from './wallet/zallet';
import { prisma } from './lib/prisma';
import { logUrl } from './lib/logUrl';

// Request logs never carry a secret (audit 5): see lib/logUrl.
const server = Fastify({
  logger: {
    serializers: {
      req: (req) => ({ method: req.method, url: logUrl(req.url), hostname: req.hostname, remoteAddress: req.ip }),
    },
  },
});

/*
 * A rejected promise nobody awaited used to end the process (Node's default).
 * The money timers fire-and-forget, so one database blip could stop the
 * server mid-settlement. Log it and stay up; every money path is written to be
 * picked up again by its reconciler on the next pass.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection (kept running):', reason);
});

async function main() {
  await server.register(cors, { origin: true });

  registerRoutes(server);

  const port = parseInt(process.env.PORT || '4000');
  /*
   * LISTEN_HOST narrows who can reach the port at all (e.g. 127.0.0.1 when the
   * tunnel is the only way in). Default unchanged, since a container or load
   * balancer in front may need every interface (audit M7).
   */
  await server.listen({ port, host: (process.env.LISTEN_HOST ?? '').trim() || '0.0.0.0' });

  /*
   * Wait for the database instead of dying without it (audit M11). A startup
   * step that threw used to exit the process, the supervisor restarted it into
   * the same outage, and it looped. Listening first means /api/health answers
   * (503, with the reason) while this waits.
   */
  for (let attempt = 1, delay = 2_000; ; attempt++, delay = Math.min(delay * 2, 60_000)) {
    try { await prisma.$queryRaw`SELECT 1`; break; } catch (e) {
      console.error(`[startup] database not reachable (attempt ${attempt}), retrying in ${delay / 1000}s:`, e instanceof Error ? e.message.split('\n').filter(Boolean).pop() : e);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Handles are unique by nameKey; rows that predate the column need one.
  await backfillNameKeys().catch((e) => console.warn('[admin] nameKey backfill failed', e));
  // Addresses proven before the proven-address table existed.
  await backfillUserAddresses().catch((e) => console.warn('[admin] address backfill failed', e));
  // Names the exact ADMIN_ADDRESS to set when it is missing or wrong.
  await explainAdmin().catch((e) => console.warn('[admin] could not check the sysop account', e));
  if ((process.env.PROXY_SHARED_SECRET ?? '').trim().length < 16) {
    console.warn('[proxy] PROXY_SHARED_SECRET is not set - the x-zec-network header is ignored from every non-loopback caller');
  }

  // Start background services
  startPaymentWatcher();
  startAuthReconciler(); // services late / tab-closed verification payments
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
