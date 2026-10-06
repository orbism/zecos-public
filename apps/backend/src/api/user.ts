import { FastifyInstance, FastifyRequest } from 'fastify';
import { logUrl } from '../lib/logUrl';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { handleReservedFor, isAdmin, canViewAdmin } from '../lib/admin';
import { proxyTrusted, isInfrastructure } from '../lib/proxyAuth';
import { badgeLookup } from '../lib/badges';

export async function getUser(req: FastifyRequest) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const session = await prisma.userSession.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.revokedAt) return null; // superseded by a newer login for this user
  // Sessions are only issued after ownership verification, but old/stray
  // sessions for unverified users must not grant access either.
  if (!session.user.isVerified) return null;
  if (session.user.frozen === 'all') return null; // sysop-frozen: no access at all
  // Presence heartbeat - at most one write per user per minute
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    const ip = clientIp(req);
    prisma.userSession.update({ where: { token }, data: { lastSeenAt: new Date(), ...(ip ? { lastIp: ip } : {}) } }).catch(() => {});
  }
  return session.user;
}

/**
 * The caller's IP, for bans, rate limits and the sysop roster. '' when unknown.
 *
 * Nobody's browser talks to this server: our Next proxy does, from Vercel
 * (AWS), through the Cloudflare tunnel. So the proxy names the browser, in
 * x-real-ip, and that is the only forwarded header read. x-forwarded-for and
 * cf-connecting-ip, for anything the proxy sends, are the proxy's own AWS
 * egress - reading them was how the roster filled with EC2 addresses for
 * people on home connections. A proxied request that names nobody gets ''
 * and callers skip the write rather than record the proxy.
 *
 * A caller that is not our proxy is a direct one, and Cloudflare's
 * cf-connecting-ip is its real address (Cloudflare overwrites that header, so
 * it cannot be forged through the tunnel). Which callers count as our proxy
 * is proxyTrusted's call: the shared secret once it is set.
 */
const lastAnonWarn = new Map<string, number>();
/**
 * `quiet`: for callers that only need an address if there is one - the request
 * limiter, which looks at EVERY request, including deliberately anonymous ones
 * like /api/price (shared-cache, so the proxy names nobody on purpose). They
 * must not raise the "named no client" warning meant for the roster's routes.
 */
export function clientIp(req: FastifyRequest, opts: { quiet?: boolean } = {}): string {
  const h = req.headers;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  if (proxyTrusted(req)) {
    /*
     * Our own header FIRST.
     *
     * Measured on production 2026-09-22: the proxy sent `x-real-ip` and this
     * process received only cf-connecting-ip, cf-ray and x-forwarded-for -
     * Cloudflare does not pass the well-known name through, and both survivors
     * are the proxy's egress, not the browser. `x-zec-proxy-secret` arrives
     * intact over the same hop, so the address travels under a namespaced name
     * too. The older names are still read: they work wherever Cloudflare is not
     * in the middle, and they are what an older proxy sends.
     *
     * x-guest-ip: what the guest routes sent before they moved to x-real-ip.
     */
    const named = pick(h['x-zec-client-ip']) || pick(h['x-real-ip']) || pick(h['x-guest-ip']);
    if (named) return named;
    if (h['cf-connecting-ip']) {
      /*
       * Our proxy, arriving through the tunnel, naming nobody. Recording
       * cf-connecting-ip here would file the proxy's own egress against a
       * person, which is what once filled the roster with EC2 addresses - so
       * nothing is recorded. It is also the exact shape of "the roster stopped
       * showing IPs", and silence made that a guessing game, so it says so at
       * most once a minute.
       */
      /*
       * PER ROUTE, not one global timer. Sharing one meant the noisiest caller
       * - the guest ping, once a minute - was the only line that ever printed,
       * and the session heartbeat's silence read as "it is fine here" when it
       * had simply lost the race. The header NAMES that did arrive are the
       * whole diagnosis, so they are named; values never are.
       */
      const route = logUrl(String(req.url ?? '')).split('?')[0] ?? '';
      const now = Date.now();
      if (!opts.quiet && now - (lastAnonWarn.get(route) ?? 0) > 60_000) {
        lastAnonWarn.set(route, now);
        const seen = ['x-zec-client-ip', 'x-real-ip', 'x-guest-ip', 'cf-connecting-ip', 'x-forwarded-for', 'x-vercel-forwarded-for', 'forwarded', 'true-client-ip']
          .filter((h) => h in req.headers);
        console.warn(
          `[ip] ${route} named no client - roster IPs will be blank. `
          + `headers present: ${seen.join(', ') || 'none of the usual ones'}`,
        );
      }
      return '';
    }
    return req.ip || '';
  }
  /*
   * Untrusted callers: cf-connecting-ip only when the request came through our
   * own infrastructure (the tunnel on loopback, a load balancer on a private
   * address). A direct caller from the internet could otherwise name any
   * address per request and slip every per-IP rate limit (audit M7).
   */
  return (isInfrastructure(req) ? pick(h['cf-connecting-ip']) : '') || req.ip || '';
}

/**
 * Exactly what the backend saw, and which branch of `clientIp` decided it.
 *
 * Written because three rounds of reasoning about this from logs and live
 * probes produced three wrong answers. The chain is browser -> Cloudflare ->
 * Next proxy -> tunnel -> here, and every hop can drop the one header that
 * names the browser. Guessing which hop is doing it is what wasted the time;
 * this reports it from inside the real path, using the SAME function the
 * roster depends on, so the two cannot disagree.
 *
 * Header NAMES only, never values - except the resolved address, which belongs
 * to the sysop making the call.
 */
export function clientIpDebug(req: FastifyRequest) {
  const h = req.headers;
  const candidates = [
    'x-zec-client-ip', 'x-real-ip', 'x-guest-ip', 'cf-connecting-ip', 'cf-ray',
    'x-forwarded-for', 'x-vercel-forwarded-for', 'forwarded', 'true-client-ip',
  ];
  const trusted = proxyTrusted(req);
  const named = Boolean(h['x-zec-client-ip'] || h['x-real-ip'] || h['x-guest-ip']);
  const branch = trusted
    ? named ? 'proxy named the browser'
      : h['cf-connecting-ip']
        ? 'REFUSED: trusted proxy named no browser (no x-zec-client-ip / x-real-ip), and cf-connecting-ip here is the proxy'
        : 'fell back to the socket address'
    : 'untrusted caller: read cf-connecting-ip or the socket';
  return {
    resolved: clientIp(req) || null,
    branch,
    proxyTrusted: trusted,
    proxySecretConfigured: (process.env.PROXY_SHARED_SECRET ?? '').trim().length >= 16,
    proxySecretPresentOnRequest: Boolean(h['x-zec-proxy-secret']),
    headersPresent: candidates.filter((k) => k in h),
    socket: req.socket?.remoteAddress ?? null,
  };
}

export async function userRoutes(server: FastifyInstance) {
  server.get('/profile', async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    return reply.send({
      address: user.address,
      /** A testnet address this account has proven and linked, or null. */
      testnetAddress: user.testnetAddress ?? null,
      displayName: user.displayName,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      hasPassword: Boolean(user.passwordHash),
      /** Opt-in: this account's name shown as the owner of its Pools. */
      showOwnerName: user.showOwnerName,
      sysop: isAdmin(user),
      sudobud: canViewAdmin(user) && !isAdmin(user),
      badges: (await badgeLookup()).forUser(user.id),
    });
  });

  /** Show or hide this account's name as the owner of its Pools (off by default). */
  server.put<{ Body: { on?: unknown } }>('/owner-name', async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    if (typeof req.body?.on !== 'boolean') return reply.status(400).send({ error: 'on: true or false' });
    if (req.body.on && !user.displayName) return reply.status(400).send({ error: 'Set a display name first' });
    await prisma.user.update({ where: { id: user.id }, data: { showOwnerName: req.body.on } });
    return reply.send({ ok: true, showOwnerName: req.body.on });
  });

  server.put<{ Body: { displayName?: string } }>('/profile', async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    const name = req.body?.displayName?.trim() || null;
    const nameKey = name?.toLowerCase() ?? null;
    if (nameKey) {
      const holder = await prisma.user.findUnique({ where: { nameKey } });
      if (holder && holder.id !== user.id)
        return reply.status(409).send({ error: 'That display name is already taken' });
      // The sysop's handle belongs to the sysop's address alone - see lib/admin.
      if (handleReservedFor(nameKey, user.address))
        return reply.status(409).send({ error: 'That display name is already taken' });
    }
    try {
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { displayName: name, nameKey },
      });
      return reply.send({ address: updated.address, displayName: updated.displayName, isVerified: updated.isVerified });
    } catch {
      return reply.status(409).send({ error: 'That display name is already taken' });
    }
  });

  server.get('/settings', async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    const s = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    return reply.send(s?.data ?? {});
  });

  server.put<{ Body: Record<string, unknown> }>('/settings', async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    const settingsData = (req.body ?? {}) as unknown as Prisma.InputJsonValue;
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, data: settingsData },
      update: { data: settingsData },
    });
    return reply.send({ ok: true });
  });

  server.get('/watchlist', async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    const w = await prisma.userWatchlist.findUnique({ where: { userId: user.id } });
    return reply.send(w?.data ?? { addresses: [] });
  });

  server.put<{ Body: { addresses: unknown[] } }>('/watchlist', async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    const watchlistData = (req.body ?? { addresses: [] }) as unknown as Prisma.InputJsonValue;
    await prisma.userWatchlist.upsert({
      where: { userId: user.id },
      create: { userId: user.id, data: watchlistData },
      update: { data: watchlistData },
    });
    return reply.send({ ok: true });
  });

  server.get('/state', async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    const st = await prisma.userState.findUnique({ where: { userId: user.id } });
    return reply.send(st?.data ?? {});
  });

  server.put<{ Body: Record<string, unknown> }>('/state', async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    const stateData = (req.body ?? {}) as unknown as Prisma.InputJsonValue;
    await prisma.userState.upsert({
      where: { userId: user.id },
      create: { userId: user.id, data: stateData },
      update: { data: stateData },
    });
    return reply.send({ ok: true });
  });
}
