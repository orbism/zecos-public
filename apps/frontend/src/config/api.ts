/**
 * Which chain a chain-data request is answered from.
 *
 * PER REQUEST, never per process. The sysop switching Pools to testnet must not
 * drag everyone else's Explorer onto testnet with them - one person looking at
 * a test chain is a preference, not a deployment setting. So the network
 * travels with the request and defaults to mainnet whenever it is absent,
 * unrecognised, or not configured on this deployment.
 */
export type ChainNetwork = 'mainnet' | 'testnet';

export const CHAIN_NETWORK_PARAM = 'net';

/** Testnet exists only where a base URL has been configured for it. */
export function testnetAvailable(): boolean {
  return Boolean((process.env.BACKEND_URL_TESTNET ?? '').trim());
}

/**
 * Normalise a configured base URL.
 *
 * An env value written as `your-host.example` - no scheme - is a perfectly
 * reasonable thing to type and a completely invalid argument to `fetch`, which
 * throws ERR_INVALID_URL and surfaces as a 502 with nothing pointing at the
 * cause. Assume https, since every host we talk to is, and drop a trailing
 * slash so the joined path never doubles up.
 */
function normalise(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export function getBaseUrl(net: ChainNetwork = 'mainnet') {
  if (net === 'testnet') {
    const url = (process.env.BACKEND_URL_TESTNET ?? '').trim();
    // Falling back to mainnet would answer a testnet question with mainnet data
    // and look like the hash simply did not exist - the same class of confusion
    // as the round-28 wallet mismatch. Better to say so.
    if (!url) throw new Error('testnet chain API is not configured on this deployment');
    return normalise(url);
  }
  return normalise(process.env.BACKEND_URL || '');
}

/**
 * One key, both hosts.
 *
 * The mainnet and testnet chain APIs are separate hostnames sharing a key -
 * the HOST decides the network, not a parameter - so there is no per-network
 * secret and inventing one would just be another variable to leave unset.
 */
export function getApiHeaders(_net: ChainNetwork = 'mainnet'): HeadersInit {
  const key = process.env.API_SECRET_KEY || '';
  const headers: HeadersInit = {};
  if (key) headers['X-API-Key'] = key;
  return headers;
}

/** Read the requested network off a request. Anything unexpected means mainnet. */
export function networkOf(req: { nextUrl: URL } | { url: string }): ChainNetwork {
  const raw = 'nextUrl' in req
    ? req.nextUrl.searchParams.get(CHAIN_NETWORK_PARAM)
    : new URL((req as { url: string }).url).searchParams.get(CHAIN_NETWORK_PARAM);
  return raw === 'testnet' && testnetAvailable() ? 'testnet' : 'mainnet';
}

// Kept for any callers that reference API_CONFIG.baseUrl directly.
export const API_CONFIG = {
  get baseUrl() { return getBaseUrl(); },
  get secretKey() { return process.env.API_SECRET_KEY || ''; },
};
