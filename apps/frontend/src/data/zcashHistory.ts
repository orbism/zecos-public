export interface ZcashEvent {
  height: number;
  date: string; // ISO date
  title: string;
  description: string;
  tag?: 'upgrade' | 'halving' | 'milestone';
}

// Heights and UTC dates checked against the ZEC-OS node; descriptions against z.cash/upgrade
// and the ZIPs (zips.z.cash). Overwinter to Canopy are named, not numbered: Zcash numbers
// upgrades from NU5 on.
export const ZCASH_HISTORY: ZcashEvent[] = [
  {
    height: 0,
    date: '2016-10-28',
    title: 'Zcash Genesis Block',
    description: 'The Zcash mainnet launched on the anniversary of the Bitcoin whitepaper. Shielded value lived in the Sprout pool, blocks came every 150 seconds, and a "slow start" ramped the block reward up over the first 20,000 blocks.',
    tag: 'milestone',
  },
  {
    height: 347500,
    date: '2018-06-26',
    title: 'Overwinter Activation',
    description: 'The first Zcash network upgrade: versioning and replay protection for future upgrades, faster transparent transaction verification, and transaction expiry (ZIPs 143, 200 to 203).',
    tag: 'upgrade',
  },
  {
    height: 419200,
    date: '2018-10-29',
    title: 'Sapling Activation',
    description: 'The upgrade that made shielded Zcash practical. Groth16 proofs on the new BLS12-381 and Jubjub curves cut shielded proving to seconds and about 40 MB of memory, so phones could do it; it also added full viewing keys and quietly closed the BCTV14 counterfeiting bug (CVE-2019-7167).',
    tag: 'upgrade',
  },
  {
    height: 653600,
    date: '2019-12-11',
    title: 'Blossom Activation',
    description: 'Block time halved from 150 to 75 seconds, doubling throughput while keeping the emission rate the same (per-block subsidy halved from 12.5 to 6.25 ZEC). ZIPs 206 and 208.',
    tag: 'upgrade',
  },
  {
    height: 903000,
    date: '2020-07-16',
    title: 'Heartwood Activation',
    description: 'Miners could send block rewards straight to shielded Sapling addresses (shielded coinbase, ZIP 213), and Flyclient support arrived for light clients (ZIP 221).',
    tag: 'upgrade',
  },
  {
    height: 1046400,
    date: '2020-11-18',
    title: 'Canopy + First Halving',
    description: "The first halving (6.25 to 3.125 ZEC per block) and the end of the Founders' Reward. Canopy started the ZIP 1014 dev fund: 20% of the subsidy split 7% ECC, 5% Zcash Foundation, 8% Major Grants. It also stopped new value entering Sprout.",
    tag: 'halving',
  },
  {
    height: 1687104,
    date: '2022-05-31',
    title: 'NU5 / Orchard Activation',
    description: 'Introduced the Orchard shielded pool on the Halo 2 proving system, with no trusted setup at all, plus Unified Addresses (one address for every pool, ZIP 316) and v5 transactions.',
    tag: 'upgrade',
  },
  {
    height: 2726400,
    date: '2024-11-23',
    title: 'NU6 + Second Halving',
    description: 'The second halving cut the block subsidy from 3.125 to 1.5625 ZEC. NU6 replaced the dev fund: 8% to Zcash Community Grants and 12% into an in-protocol lockbox for a future decision (ZIP 1015).',
    tag: 'halving',
  },
  {
    height: 3000000,
    date: '2025-07-20',
    title: 'Block 3,000,000',
    description: "Zcash reached its 3 millionth block, about 8 years and 9 months after genesis.",
    tag: 'milestone',
  },
  {
    height: 3146400,
    date: '2025-11-24',
    title: 'NU6.1 Activation',
    description: 'A dual funding model: 8% of block rewards to Zcash Community Grants and 12% to a fund directed by coinholder decisions, with a one-time lockbox disbursement (ZIPs 255, 271, 1016).',
    tag: 'upgrade',
  },
  {
    height: 3363426,
    date: '2026-06-02',
    title: 'Orchard Soft Fork',
    description: 'An emergency soft fork banned all Orchard actions after a counterfeiting bug was found in the Orchard circuit, closing the window while a fixed circuit was prepared (ZIP 257).',
    tag: 'upgrade',
  },
  {
    height: 3364600,
    date: '2026-06-03',
    title: 'NU6.2 Activation',
    description: 'An emergency upgrade that re-enabled Orchard with a corrected scalar multiplication gadget and a new verifying key (ZIP 257).',
    tag: 'upgrade',
  },
  {
    // Height reported by our own node as zebra.ironwoodActivationHeight; z.cash/upgrade/nu6-3 agrees.
    height: 3428143,
    date: '2026-07-28',
    title: 'NU6.3 / Ironwood Activation',
    description: 'Ironwood joined Sprout, Sapling and Orchard as a shielded pool, with quantum-recoverable notes (ZIP 2005) and v6 transactions (ZIP 229). Orchard closed to new value, and coins leaving it pass a turnstile so supply integrity can be checked (ZIP 258).',
    tag: 'upgrade',
  },
];

// Height → nearest event within a given radius (for Explorer banners)
export function nearestEvent(height: number, radius = 5): ZcashEvent | null {
  for (const event of ZCASH_HISTORY) {
    if (Math.abs(event.height - height) <= radius) return event;
  }
  return null;
}

// Rough block height from a unix timestamp (≥653600 era uses 75s blocks)
// Used as a starting point for date-based search; Explorer still needs to binary-search via API.
export function estimateHeightFromDate(unixMs: number): number {
  const BLOSSOM_HEIGHT = 653600;
  const BLOSSOM_TIME_S = 1576088800; // ~Dec 11 2019
  const unixS = unixMs / 1000;
  if (unixS < BLOSSOM_TIME_S) {
    // Pre-Blossom: ~150s blocks, genesis at ~1477692781
    const GENESIS_TIME_S = 1477692781;
    return Math.max(1, Math.round((unixS - GENESIS_TIME_S) / 150));
  }
  return BLOSSOM_HEIGHT + Math.round((unixS - BLOSSOM_TIME_S) / 75);
}
