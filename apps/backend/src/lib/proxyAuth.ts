import type { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'crypto';

/**
 * Is this request from OUR front door?
 *
 * The backend is reachable directly, so nothing about a request proves it came
 * through the Next.js proxy - unless the proxy says so with a secret only it
 * holds. PROXY_SHARED_SECRET, set on both sides, is that proof. Callers on
 * the box itself (the wallet manager, curl) are trusted without it.
 *
 * "On the box" cannot mean loopback alone: the Cloudflare tunnel connects from
 * loopback too, so by that test every request from the internet was local and
 * the secret proved nothing. Tunnel traffic carries Cloudflare's headers; a
 * loopback request without them really is local.
 *
 * Unset (fewer than 16 characters): only a genuinely local caller (loopback
 * with no Cloudflare headers) is trusted. The tunnel is not (audit M8).
 */
export const PROXY_SECRET_HEADER = 'x-zec-proxy-secret';

function configured(): string {
  return (process.env.PROXY_SHARED_SECRET ?? '').trim();
}

export function isLoopback(req: FastifyRequest): boolean {
  const ip = req.socket?.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Loopback, or a private-network address: something in front of us on our own
 * network (the tunnel, a load balancer). A caller on the public internet is
 * never this, so it cannot claim a forwarded address.
 */
export function isInfrastructure(req: FastifyRequest): boolean {
  if (isLoopback(req)) return true;
  const ip = (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip);
}

/**
 * Really on this box: loopback AND not carrying Cloudflare's headers. The
 * tunnel connects from loopback too, so loopback alone let anyone on the
 * internet count as local (audit M8).
 */
export function isLocalCaller(req: FastifyRequest): boolean {
  return isLoopback(req) && !req.headers['cf-connecting-ip'] && !req.headers['cf-ray'];
}

export function proxyTrusted(req: FastifyRequest): boolean {
  const secret = configured();
  // No secret configured: only a genuinely local caller - never the tunnel.
  if (secret.length < 16) return isLocalCaller(req);
  const raw = req.headers[PROXY_SECRET_HEADER];
  const given = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  if (given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return true;
  return isLocalCaller(req);
}
