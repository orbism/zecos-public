import type { BackendNetwork } from '../wallet/zallet';

/**
 * Confirmations a payment needs before a cut, purchase or send SETTLES (audit
 * H5). Settling hands something over - a Pool, a transfer - and a reorg that
 * takes the payment back does not take that back, so mainnet waits a little
 * longer. Money leaving the wallet waits longer again (PAYOUT_MINCONF).
 */
const MAINNET = Math.max(1, Math.min(10, parseInt(process.env.SETTLE_MINCONF_MAINNET ?? '2', 10) || 2));
const TESTNET = Math.max(1, Math.min(10, parseInt(process.env.SETTLE_MINCONF_TESTNET ?? '1', 10) || 1));

export function settleMinconf(net: BackendNetwork): number {
  return net === 'mainnet' ? MAINNET : TESTNET;
}
