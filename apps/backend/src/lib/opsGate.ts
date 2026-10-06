// Shared gate for operator-only HTTP surfaces driven from local tools on this
// box (the wallet manager, the control panel) rather than from a browser
// session on zec-os.com.
//
// The session-based admin surfaces authenticate a logged-in operator
// (requireAdmin: a verified session whose displayName matches ADMIN_HANDLE).
// Local tools have no session, so they present a shared secret instead, and are
// additionally restricted to loopback. With the token unset the caller is
// expected to leave its routes unregistered entirely, so a default install
// exposes no such surface at all rather than one that merely rejects requests.
//
// NOTE: src/api/auth-ops.ts predates this module and still carries its own copy
// of the same logic. It is deliberately left untouched — it is live and in use.
// Collapsing it onto this module is a one-import change worth making the next
// time that file is edited for another reason.

import { logUrl } from './logUrl';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'crypto';

// Long enough that a token typed in by hand is not guessable. Routes stay
// unregistered below this, so a half-configured install fails closed.
export const MIN_TOKEN_LENGTH = 24;

// req.ip is the socket peer here: fastify's trustProxy is not enabled, so an
// X-Forwarded-For header cannot forge this.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function opsToken(envVar: string): string {
  return (process.env[envVar] ?? '').trim();
}

export function opsEnabled(envVar: string): boolean {
  return opsToken(envVar).length >= MIN_TOKEN_LENGTH;
}

function bearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** Null when the request may proceed, otherwise the reason to refuse it. */
export function opsDenied(req: FastifyRequest, envVar: string): string | null {
  // Loopback AND not the tunnel: over the tunnel the token was the only gate (audit M8).
  if (!LOOPBACK.has(req.ip) || req.headers['cf-connecting-ip'] || req.headers['cf-ray']) return 'ops endpoints are loopback-only';
  const expected = Buffer.from(opsToken(envVar), 'utf8');
  const given = Buffer.from(bearer(req), 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a comparison,
  // so the lengths are checked first and the content compare only runs when
  // they match.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'bad ops token';
  return null;
}

/** Refuse every request to this plugin scope that is not local + correctly tokened. */
export function guardWithOpsToken(server: FastifyInstance, envVar: string, label: string): void {
  server.addHook('onRequest', async (req, reply) => {
    const reason = opsDenied(req, envVar);
    if (reason !== null) {
      server.log.warn({ ip: req.ip, url: logUrl(req.url) }, `[${label}] refused: ${reason}`);
      return reply.status(403).send({ error: reason });
    }
  });
}
