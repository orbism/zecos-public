import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';
import { getUser } from './user';
import { isAdmin } from '../lib/admin';

/**
 * Beta app switches: which beta apps run on live data for everyone.
 *
 *   GET  /api/beta          public  -> { enabled: { "<appId>": boolean } }
 *   POST /api/beta/admin    sysop   body { enabled: patch } -> { enabled: full map }
 *
 * A beta app that is switched off still opens for the public, but only as a
 * preview on sample data. The sysop and sudobuds see it live either way (the
 * frontend decides that). Anything this route cannot answer reads as "all
 * off", so a failure can only ever put apps back into preview.
 *
 * Storage reuses the HelpVideoSwitch table under a "beta/" key prefix: the
 * same one-boolean-per-key shape, so no schema change. The prefix keeps the
 * two sets apart; this route only ever reads and writes "beta/" keys.
 */

const PREFIX = 'beta/';
const APP_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_PATCH = 100;
const TTL_MS = 5_000;

let cache: { at: number; enabled: Record<string, boolean> } | null = null;

async function readAll(): Promise<Record<string, boolean>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.enabled;
  const rows = await prisma.helpVideoSwitch.findMany({
    where: { key: { startsWith: PREFIX } },
    select: { key: true, enabled: true },
  });
  const enabled = Object.fromEntries(rows.map((r) => [r.key.slice(PREFIX.length), r.enabled]));
  cache = { at: Date.now(), enabled };
  return enabled;
}

/** Whether a beta app is switched live for everyone. Any failure reads as off. */
export async function betaLive(appId: string): Promise<boolean> {
  try { return (await readAll())[appId] === true; } catch { return false; }
}

async function requireAdmin(req: FastifyRequest) {
  const u = await getUser(req);
  return u && u.isVerified && isAdmin(u) ? u : null;
}

export async function betaRoutes(server: FastifyInstance) {
  server.get('/', async (_req, reply) => {
    try {
      return reply.send({ enabled: await readAll() });
    } catch (e) {
      server.log.warn({ err: e }, '[beta] could not read beta switches');
      return reply.status(503).send({ enabled: {}, error: 'unavailable' });
    }
  });

  server.post<{ Body: { enabled?: Record<string, unknown> } }>('/admin', async (req, reply) => {
    const user = await requireAdmin(req);
    if (!user) return reply.status(403).send({ error: 'Sysop only' });

    const patch = req.body?.enabled;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return reply.status(400).send({ error: 'Body must be { enabled: { "<appId>": boolean } }' });
    }
    const entries = Object.entries(patch);
    if (entries.length === 0) return reply.send({ enabled: await readAll() });
    if (entries.length > MAX_PATCH) return reply.status(400).send({ error: `At most ${MAX_PATCH} switches at once` });
    for (const [k, v] of entries) {
      if (!APP_ID.test(k)) return reply.status(400).send({ error: `Bad app id: ${k.slice(0, 60)}` });
      if (typeof v !== 'boolean') return reply.status(400).send({ error: `Value for ${k} must be true or false` });
    }

    const by = user.displayName ?? `${(user.address ?? '').slice(0, 10)}...`;
    await prisma.$transaction(entries.map(([id, on]) => prisma.helpVideoSwitch.upsert({
      where: { key: PREFIX + id },
      create: { key: PREFIX + id, enabled: on as boolean, updatedBy: by },
      update: { enabled: on as boolean, updatedBy: by },
    })));
    cache = null;
    return reply.send({ enabled: await readAll() });
  });
}
