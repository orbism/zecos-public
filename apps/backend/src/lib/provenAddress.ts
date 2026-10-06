import { looksLikeAddress } from '../wallet/rpc';
import type { BackendNetwork } from '../wallet/zallet';

/**
 * The address this account has PROVEN it controls, on this network - or null.
 *
 * Every place that used to read `user.address` directly for an acquisition
 * (cutting, buying, the allowance) reads this instead. It used to be assumed
 * that a verified account's address was valid on whatever chain the app was
 * on, which is only true on mainnet: a verified account on a testnet deployment
 * had a mainnet address forced into a testnet order, was refused with "that
 * does not look like a testnet Zcash address", and was never offered a way to
 * name one.
 *
 * Null is a normal answer, not an error. It means "no proven address here", and
 * the caller falls back to the address the person names, on guest terms. That
 * last part matters: the verified discount belongs to a PROVEN address, so an
 * account naming arbitrary addresses would otherwise get discounted Pools across
 * as many fresh addresses as it liked, which is exactly what the per-address
 * cap exists to stop.
 */
export function provenAddress(
  user: { address: string; testnetAddress?: string | null; isVerified: boolean; frozen: string | null } | null,
  net: BackendNetwork,
): string | null {
  if (!user || !user.isVerified || user.frozen) return null;
  /*
   * On testnet the linked column first, then the account's OWN address when that
   * is itself a testnet address. Accounts created before the mainnet-only rule
   * can be; linking that same address again is answered "already linked"
   * without writing the column, so reading only the column priced them as
   * guests forever while telling them to link what they had already proven.
   */
  const candidates = net === 'testnet' ? [user.testnetAddress, user.address] : [user.address];
  return candidates.find((a): a is string => Boolean(a) && looksLikeAddress(a!, net)) ?? null;
}
