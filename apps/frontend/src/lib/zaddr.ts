/**
 * Zcash address helpers that run entirely in the browser: what kind of
 * address a string is, and the ZIP 320 conversion between a transparent
 * P2PKH address (t1...) and its TEX form (tex1...).
 *
 * Detection is by prefix and character set, plus a full checksum where we
 * implement the encoding (Base58Check for t-addresses, Bech32m for TEX).
 * Unified and Sapling addresses are recognised by prefix and length only;
 * the Address Decoder app does the deep decode on the server.
 */

export type AddrKind = 'transparent-p2pkh' | 'transparent-p2sh' | 'tex' | 'sapling' | 'unified' | 'sprout' | 'unknown';

export interface AddrInfo {
  kind: AddrKind;
  network: 'mainnet' | 'testnet' | null;
  /** Checksum verified (t-addresses and TEX only; null where we only check the shape). */
  checksum: boolean | null;
  label: string;
  /** True for anything that can receive into a shielded pool. */
  shielded: boolean;
}

const LABELS: Record<AddrKind, string> = {
  'transparent-p2pkh': 'Transparent (t1)',
  'transparent-p2sh': 'Transparent multisig (t3)',
  tex: 'TEX (transparent-only)',
  sapling: 'Sapling shielded (zs1)',
  unified: 'Unified (u1)',
  sprout: 'Sprout (zc, legacy)',
  unknown: 'Not a Zcash address',
};

// ── SHA-256 (small, synchronous; for Base58Check checksums) ──────────────────
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length, bitLen = len * 8;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(msg); padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15]!, 7) ^ rotr(W[i - 15]!, 18) ^ (W[i - 15]! >>> 3);
      const s1 = rotr(W[i - 2]!, 17) ^ rotr(W[i - 2]!, 19) ^ (W[i - 2]! >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + S1 + ch + K[i]! + W[i]!) >>> 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const mj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a!) >>> 0; H[1] = (H[1]! + b!) >>> 0; H[2] = (H[2]! + c!) >>> 0; H[3] = (H[3]! + d!) >>> 0;
    H[4] = (H[4]! + e!) >>> 0; H[5] = (H[5]! + f!) >>> 0; H[6] = (H[6]! + g!) >>> 0; H[7] = (H[7]! + h!) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]!);
  return out;
}

// ── Base58Check ─────────────────────────────────────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// BigInt() rather than literals: the build targets below ES2020.
const N0 = BigInt(0), N58 = BigInt(58), N256 = BigInt(256);
function b58decode(s: string): Uint8Array | null {
  let n = N0;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * N58 + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > N0) { bytes.unshift(Number(n % N256)); n /= N256; }
  for (const ch of s) { if (ch === '1') bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}
function b58encode(b: Uint8Array): string {
  let n = N0;
  for (const x of b) n = n * N256 + BigInt(x);
  let s = '';
  while (n > N0) { s = B58[Number(n % N58)] + s; n /= N58; }
  for (const x of b) { if (x === 0) s = '1' + s; else break; }
  return s;
}
function b58checkDecode(s: string): Uint8Array | null {
  const raw = b58decode(s);
  if (!raw || raw.length < 5) return null;
  const body = raw.slice(0, -4), sum = raw.slice(-4);
  const h = sha256(sha256(body));
  for (let i = 0; i < 4; i++) if (h[i] !== sum[i]) return null;
  return body;
}
function b58checkEncode(body: Uint8Array): string {
  const h = sha256(sha256(body));
  const out = new Uint8Array(body.length + 4);
  out.set(body); out.set(h.slice(0, 4), body.length);
  return b58encode(out);
}

// ── Bech32m ─────────────────────────────────────────────────────────────────
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;
function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk >>> 0;
}
const hrpExpand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | null {
  let acc = 0, bits = 0;
  const out: number[] = [], maxv = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (v < 0 || v >> from) return null;
    acc = (acc << from) | v; bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}
function bech32mEncode(hrp: string, data: Uint8Array): string {
  const words = convertBits(data, 8, 5, true)!;
  const values = [...hrpExpand(hrp), ...words];
  const mod = polymod([...values, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST;
  const sum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...sum].map((w) => CHARSET[w]).join('')}`;
}
function bech32mDecode(s: string): { hrp: string; data: Uint8Array } | null {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return null;
  const str = s.toLowerCase(), pos = str.lastIndexOf('1');
  if (pos < 1 || pos + 7 > str.length) return null;
  const hrp = str.slice(0, pos);
  const words: number[] = [];
  for (const ch of str.slice(pos + 1)) { const v = CHARSET.indexOf(ch); if (v < 0) return null; words.push(v); }
  if (polymod([...hrpExpand(hrp), ...words]) !== BECH32M_CONST) return null;
  const bytes = convertBits(words.slice(0, -6), 5, 8, false);
  return bytes ? { hrp, data: Uint8Array.from(bytes) } : null;
}

// ── TEX (ZIP 320) ───────────────────────────────────────────────────────────
const P2PKH_MAIN = [0x1c, 0xb8], P2SH_MAIN = [0x1c, 0xbd], P2PKH_TEST = [0x1d, 0x25], P2SH_TEST = [0x1c, 0xba];

/** t1... (P2PKH) to tex1... Null if it is not a valid mainnet P2PKH address. */
export function t1ToTex(t1: string): string | null {
  const body = b58checkDecode(t1.trim());
  if (!body || body.length !== 22 || body[0] !== P2PKH_MAIN[0] || body[1] !== P2PKH_MAIN[1]) return null;
  return bech32mEncode('tex', body.slice(2));
}

/** tex1... to its t1... form. Null if it is not a valid TEX address. */
export function texToT1(tex: string): string | null {
  const d = bech32mDecode(tex.trim());
  if (!d || d.hrp !== 'tex' || d.data.length !== 20) return null;
  return b58checkEncode(Uint8Array.from([...P2PKH_MAIN, ...d.data]));
}

// ── Detection ───────────────────────────────────────────────────────────────
export function detectAddress(raw: string): AddrInfo {
  const a = raw.trim();
  const make = (kind: AddrKind, network: AddrInfo['network'], checksum: boolean | null): AddrInfo =>
    ({ kind, network, checksum, label: LABELS[kind], shielded: kind === 'sapling' || kind === 'unified' || kind === 'sprout' });

  if (/^t[1-3m2][1-9A-HJ-NP-Za-km-z]{32,34}$/.test(a)) {
    const body = b58checkDecode(a);
    const ok = !!body && body.length === 22;
    const p = ok ? [body![0], body![1]] : [];
    const eq = (x: number[]) => p[0] === x[0] && p[1] === x[1];
    if (eq(P2PKH_MAIN)) return make('transparent-p2pkh', 'mainnet', true);
    if (eq(P2SH_MAIN)) return make('transparent-p2sh', 'mainnet', true);
    if (eq(P2PKH_TEST)) return make('transparent-p2pkh', 'testnet', true);
    if (eq(P2SH_TEST)) return make('transparent-p2sh', 'testnet', true);
    return make(a.startsWith('t3') ? 'transparent-p2sh' : 'transparent-p2pkh', null, false);
  }
  if (/^tex(test)?1/i.test(a)) {
    const d = bech32mDecode(a);
    const ok = !!d && (d.hrp === 'tex' || d.hrp === 'textest') && d.data.length === 20;
    return make('tex', d?.hrp === 'textest' ? 'testnet' : 'mainnet', ok);
  }
  if (/^u1[02-9ac-hj-np-z]{100,}$/.test(a)) return make('unified', 'mainnet', null);
  if (/^utest1[02-9ac-hj-np-z]{100,}$/.test(a)) return make('unified', 'testnet', null);
  if (/^zs1[02-9ac-hj-np-z]{75}$/.test(a)) return make('sapling', 'mainnet', null);
  if (/^ztestsapling1[02-9ac-hj-np-z]{75}$/.test(a)) return make('sapling', 'testnet', null);
  if (/^zc[1-9A-HJ-NP-Za-km-z]{93}$/.test(a)) return make('sprout', 'mainnet', null);
  return make('unknown', null, null);
}
