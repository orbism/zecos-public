import type { ChainNetwork } from './api';

/**
 * What a given chain can actually answer.
 *
 * The chain API is two kinds of route wearing one hostname:
 *
 *   RPC-BACKED   /api/chain, /api/block, /api/tx, /api/mempool, /api/status,
 *                /api/decode-address - these ask the node, so they work on any
 *                chain the node is running.
 *
 *   INDEX-BACKED /api/address, /api/price(s), /api/pools, /api/daily,
 *                /api/flows, /api/miners, /api/zakura - these read the indexer
 *                database, which ingests MAINNET ONLY.
 *
 * The testnet host refuses the second group with a 404 rather than serving
 * mainnet rows under a testnet hostname, which is the right call: silently
 * correct-looking wrong data is worse than a missing feature.
 *
 * This table exists so the UI can HIDE what has no data instead of discovering
 * it by failed request - a page that fires three fetches and dies because one
 * of them was never going to work reads as broken, when in fact the chain
 * simply does not have that.
 *
 * Parity would mean a second database and a second indexer ingesting testnet.
 * Until someone wants that, absence is the honest answer.
 */
export type ChainFeature =
  | 'block' | 'transaction' | 'mempool' | 'chain' | 'decodeAddress'
  | 'address' | 'price' | 'pools' | 'daily' | 'flows' | 'miners';

const INDEX_BACKED: ChainFeature[] = ['address', 'price', 'pools', 'daily', 'flows', 'miners'];

export function availableOn(net: ChainNetwork, feature: ChainFeature): boolean {
  return net === 'mainnet' || !INDEX_BACKED.includes(feature);
}

/** Why a feature is missing, for a UI that would otherwise just show nothing. */
export function unavailableReason(feature: ChainFeature): string {
  return INDEX_BACKED.includes(feature)
    ? 'not available on testnet: this reads the indexer database, which ingests mainnet only'
    : 'not available on this chain';
}
