import { NextResponse } from 'next/server';
import { getBaseUrl, getApiHeaders, testnetAvailable } from '@/config/api';
import { proxyHeaders } from '@/lib/backendHeaders';

/**
 * Is the stack behind ZEC-OS actually answering?
 *
 * ONE endpoint for the whole app, because the alternative is every screen
 * discovering an outage on its own and saying something different about it. The
 * splash needs to know whether a NEW account can be verified; the desktop needs
 * to say, once, that some things are down and coming back. Both read this.
 *
 * Cached here for HEALTH_TTL_MS, so a room full of tabs polling every 30s costs
 * the two upstreams one check between them. Deliberately cheap upstream calls:
 * the chain's own status page and the backend's load beacon, which is in-memory
 * on that side and touches neither the database nor the wallet.
 *
 * FAILURE IS NOT AN OUTAGE. A check that throws marks only its own service, and
 * a timeout is a failure like any other - a hung upstream must not hang this.
 */

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';
const HEALTH_TTL_MS = 20_000;
const PROBE_TIMEOUT_MS = 6_000;

export type ServiceState = 'up' | 'down' | 'busy';
/** A chain this deployment does not have is not a chain that is down. */
export type ChainState = ServiceState | 'off';

export interface Health {
  /** Everything a visitor needs is working. */
  ok: boolean;
  /** Account verification and sign-in. 'busy' means the wallet cannot see payments yet. */
  auth: ServiceState;
  /** The chain API behind the Explorer, charts and block views. Mainnet. */
  chain: ServiceState;
  /**
   * Both chains, for the taskbar's status flyout.
   *
   * Separate from `chain` rather than replacing it: `chain` is "can this
   * visitor use the app", which has always meant mainnet, and the splash reads
   * it to decide whether to let someone in. Testnet being down is not a reason
   * to tell anybody anything - it is a reason for one line in a status panel.
   */
  chains: { mainnet: ServiceState; testnet: ChainState };
  /** The payment wallet. 'busy' while it catches up with the chain. */
  wallet: ServiceState;
  /** Plain names of what is affected, for the message people actually read. */
  affected: string[];
  at: number;
}

let cached: { at: number; health: Health } | null = null;

async function probe(url: string, headers: HeadersInit): Promise<Record<string, unknown> | null> {
  const stop = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: stop, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** One chain API's own opinion of itself, turned into a state. */
function chainState(status: Record<string, unknown> | null): ServiceState {
  if (!status) return 'down';
  const zebra = (status.zebra ?? null) as { healthy?: boolean; syncPercent?: number } | null;
  if (!zebra) return 'up';
  if (zebra.healthy === false) return 'down';
  // Syncing with a full percent is the normal steady state; only a genuinely
  // incomplete sync counts as busy.
  return typeof zebra.syncPercent === 'number' && zebra.syncPercent < 99.5 ? 'busy' : 'up';
}

async function measure(req: Request): Promise<Health> {
  const hasTestnet = testnetAvailable();
  const [chainStatus, beacon, testnetStatus] = await Promise.all([
    probe(`${getBaseUrl('mainnet')}/api/status`, getApiHeaders('mainnet')),
    probe(`${BACKEND}/api/health`, proxyHeaders(req)),
    // Only where it exists. A deployment with no testnet host must not report
    // a chain it has never had as one that has failed.
    hasTestnet ? probe(`${getBaseUrl('testnet')}/api/status`, getApiHeaders('testnet')) : Promise.resolve(null),
  ]);

  /*
   * The chain API answers, but its node may still be catching up. Syncing with
   * a full percent is the normal steady state, so only an unhealthy node or a
   * genuinely incomplete sync counts as busy.
   */
  const chain: ServiceState = chainState(chainStatus);
  const testnet: ChainState = hasTestnet ? chainState(testnetStatus) : 'off';

  /*
   * The backend answering at all is what authentication needs: the challenge,
   * the code and the session all live there. The wallet is separate - it can be
   * behind the chain while the backend is perfectly healthy - and the beacon
   * already says which, so this does not ask the wallet anything itself.
   */
  const auth: ServiceState = beacon ? 'up' : 'down';
  const wallet: ServiceState = !beacon ? 'down'
    : beacon.admission === 'closed' && beacon.reason === 'wallet' ? 'busy'
    : 'up';

  const affected: string[] = [];
  if (auth !== 'up') affected.push('signing in and new account verification');
  else if (wallet === 'busy') affected.push('new account verification and buying');
  if (chain !== 'up') affected.push('the explorer, block views and charts');

  return {
    ok: affected.length === 0, auth, chain, wallet, affected,
    chains: { mainnet: chain, testnet },
    at: Date.now(),
  };
}

export async function GET(req: Request) {
  if (cached && Date.now() - cached.at < HEALTH_TTL_MS) {
    return NextResponse.json(cached.health, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=20' } });
  }
  const health = await measure(req);
  cached = { at: Date.now(), health };
  return NextResponse.json(health, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=20' } });
}
