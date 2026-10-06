/**
 * Accept a number pasted with thousands separators: "3,333,333" is block
 * 3333333, and "#1,234" is Pool #1234.
 *
 * Only an input that is nothing but digits and commas (with an optional leading
 * "#") is touched. Hashes, txids and addresses never contain commas, so no
 * other input can change.
 */
export function normaliseSearchInput(raw: string): string {
  const q = raw.trim();
  const m = /^(#?)(\d[\d,]*)$/.exec(q);
  return m ? m[1]! + m[2]!.replace(/,/g, '') : q;
}
