import type { FastifyInstance, FastifyRequest } from 'fastify';
import { allowedNetworks, type BackendNetwork } from './zallet';
import { proxyTrusted } from '../lib/proxyAuth';

/**
 * Which chain a single request operates on.
 *
 * One instance serves both, so the network is a property of the REQUEST, never
 * of the process. `BACKEND_NETWORK` must stay unset in production - it is the
 * global this replaces, and leaving it set would pin every request to one chain.
 *
 * THE HEADER IS NOT TRUSTWORTHY ON ITS OWN.
 * This service is reachable directly on :4000 and publicly at
 * your-host.example, so anyone can send `x-zec-network`. Two things make
 * that safe:
 *
 *   1. The edge (dashboard middleware) DELETES the inbound header and re-sets it
 *      from its own routing, so a browser cannot forge it there.
 *   2. This deployment allowlist. A box that has not opted into testnet ignores
 *      the header entirely, so it can never be talked onto another chain.
 *
 * Absent, unrecognised, or not-allowed all resolve to MAINNET. There is no
 * 'mainnet' header value and none should be added - mainnet is the absence of a
 * signal, which is the conservative reading and keeps the live app's behaviour
 * unchanged when nothing is set.
 */
export const NETWORK_HEADER = 'x-zec-network';

declare module 'fastify' {
  interface FastifyRequest {
    /** Resolved once per request. Never read the header directly. */
    zecNetwork: BackendNetwork;
  }
}

export function resolveRequestNetwork(req: FastifyRequest): BackendNetwork {
  const raw = req.headers[NETWORK_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw ?? '').trim().toLowerCase();
  if (value !== 'testnet') return 'mainnet';
  if (!allowedNetworks().includes('testnet')) return 'mainnet';
  // The header is honoured only from a caller that can prove it is our proxy
  // (or is on the box). Point 1 in the comment above described an edge
  // middleware that never existed; this is what actually stops a browser
  // from talking a request onto testnet.
  return proxyTrusted(req) ? 'testnet' : 'mainnet';
}

/** Attach `request.zecNetwork` to every request. Register before any route. */
export function registerRequestNetwork(server: FastifyInstance): void {
  server.decorateRequest('zecNetwork', 'mainnet');
  server.addHook('onRequest', async (req) => {
    req.zecNetwork = resolveRequestNetwork(req);
  });
}

/**
 * The network for a request, for call sites that only hold the request.
 *
 * Falls back to mainnet rather than throwing if the hook has not run, because a
 * missing decoration must not take a payment route down - and mainnet is the
 * value that preserves existing behaviour.
 */
export function netOf(req: FastifyRequest): BackendNetwork {
  return req.zecNetwork ?? 'mainnet';
}
