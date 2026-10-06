/**
 * ZIP 321 payment requests: `zcash:<address>?amount=..&memo=..&message=..`.
 *
 * - amount: decimal ZEC, at most 8 decimal places.
 * - memo: base64url (no padding) of the UTF-8 bytes, at most 512 bytes, and
 *   only for shielded recipients (a transparent address cannot carry one).
 * - message: free text shown by the payer's wallet, percent-encoded.
 */

const B64URL = (bytes: Uint8Array) => {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const MEMO_MAX_BYTES = 512;
export const memoBytes = (memo: string) => new TextEncoder().encode(memo).length;
export const canMemo = (address: string) => /^(zs1|u1|ztestsapling1|utest1)/.test(address.trim());

/** Normalise an amount string to ZIP 321's form, or null if it is not a valid positive amount. */
export function normAmount(a: string): string | null {
  const s = a.trim();
  if (!/^\d{1,8}(\.\d{1,8})?$/.test(s) || Number(s) <= 0) return null;
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function paymentUri(o: { address: string; amount?: string; memo?: string; message?: string }): string {
  const q: string[] = [];
  const amt = o.amount ? normAmount(o.amount) : null;
  if (amt) q.push(`amount=${amt}`);
  if (o.memo && canMemo(o.address) && memoBytes(o.memo) <= MEMO_MAX_BYTES) q.push(`memo=${B64URL(new TextEncoder().encode(o.memo))}`);
  if (o.message) q.push(`message=${encodeURIComponent(o.message)}`);
  return `zcash:${o.address.trim()}${q.length ? `?${q.join('&')}` : ''}`;
}
