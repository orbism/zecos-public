/**
 * Shape checks for path parameters that get interpolated into an UPSTREAM url.
 *
 * Next decodes route params before handing them over, so `%2e%2e%2f` arrives
 * as `../` and, spliced raw into `${base}/api/block/${id}`, walks the request
 * to any path on the chain API - carrying the server's API key with it.
 * Nothing that is not a height, a hash or an address is allowed through.
 */
export const isHex64 = (s: string): boolean => /^[0-9a-fA-F]{64}$/.test(s);
export const isHeight = (s: string): boolean => /^\d{1,10}$/.test(s);
export const isBlockId = (s: string): boolean => isHeight(s) || isHex64(s);
/** t1/t3/zs1/u1 etc: base58 or bech32 characters only, bounded. */
export const isZcashAddress = (s: string): boolean => /^[A-Za-z0-9]{20,400}$/.test(s);
