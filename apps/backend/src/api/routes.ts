import type { FastifyInstance } from 'fastify';
import { configRoutes } from './config';
import { authRoutes } from './auth';
import { userRoutes } from './user';
import { guestRoutes } from './guest';
import { broadcastRoutes } from './broadcast';
import { priceRoutes } from '../price/routes';
import { feedbackRoutes } from './feedback';
import { registerRequestNetwork } from '../wallet/requestNetwork';
import { registerRequestLimit } from '../lib/requestLimit';
import { betaRoutes } from './beta';
import { payRoutes } from './pay';
import { registrationRoutes } from './registration';
import { imRoutes } from './im';
import { healthRoutes } from './health';
import { badgeRoutes } from './badges';
import { zeometryRoutes } from './zeometry';
import { zkylineRoutes } from './zkyline';
import { installDebugger, debugRoutes } from './debug';
import { moderationRoutes } from './moderation';
import { startMetrics, recordEndpoint } from '../lib/metrics';

export function registerRoutes(server: FastifyInstance) {
  // Every request answered, by route pattern, for the sysop's Metrics app (lib/metrics).
  startMetrics();
  server.addHook('onResponse', (req, reply, done) => {
    recordEndpoint(req.routeOptions?.url ?? 'unmatched', req.method, reply.statusCode, reply.elapsedTime);
    done();
  });
  // Resolve the request's network before any route runs.
  registerRequestNetwork(server);
  // Per-address ceilings, tighter on the heavy public reads (audit M9).
  registerRequestLimit(server);

  // Deployer health check: one read per model group, 200 or 503. See api/health.ts.
  server.register(healthRoutes, { prefix: '/api/health' });
  server.register(configRoutes, { prefix: '/api/config' });
  server.register(priceRoutes, { prefix: '/api/price' });
  server.register(authRoutes, { prefix: '/api/auth' });
  server.register(userRoutes, { prefix: '/api/user' });
  server.register(guestRoutes, { prefix: '/api/guest' });
  server.register(broadcastRoutes, { prefix: '/api/broadcast' });
  server.register(feedbackRoutes, { prefix: '/api/feedback' });
  // The memo-watch sidecar's webhook. Its own scope: none of the rings hooks apply.
  // Sending a Pool to an address; same prefix as the rest of the Pools API.
  // Public traffic across the collection, either network. See api/ringTraffic.ts.
  // Help-video switches: public read, sysop write. See api/help.ts.
  server.register(betaRoutes, { prefix: '/api/beta' });
  server.register(payRoutes, { prefix: '/api/pay' });
  // The sysop's new-registration switch; the login screen reads it.
  server.register(registrationRoutes, { prefix: '/api/registration' });
  // Zcash Instant Messenger: buddies, profile pictures, messages.
  server.register(imRoutes, { prefix: '/api/im' });
  server.register(badgeRoutes, { prefix: '/api/badges' });
  // Fully Shielded State: locking a Pool for 2..256 days. See api/shield.ts.
  // ZOOM (the ZEC-OS Doom): leaderboards for verified accounts. See api/zoom.ts.
  // Zeometry Wars: weekly and all-time boards per mode. See api/zeometry.ts.
  server.register(zeometryRoutes, { prefix: '/api/zeometry' });
  // Zkyline: time-survived boards, timed by the server. See api/zkyline.ts.
  server.register(zkylineRoutes, { prefix: '/api/zkyline' });
  // Sysop-only usage metrics. See api/metrics.ts.
  // System Debugger: traffic and recent errors, sysop only, in memory. See api/debug.ts.
  installDebugger(server);
  server.register(debugRoutes, { prefix: '/api/debug' });
  // Moderation: account list and freeze, sysop only. See api/moderation.ts.
  server.register(moderationRoutes, { prefix: '/api/moderation' });
  // NOT registered: ethRoutes. Swap talks to eth/client in-process,
  // so the HTTP surface is only needed by the external wallet manager.
  // NOTE: legacy characterRoutes/leaderboardRoutes (passphrase-based Character
  // identity) are retired - the RPG tournament is keyed to verified Users via
  // /api/rpg. Files remain on disk; tables untouched.
}