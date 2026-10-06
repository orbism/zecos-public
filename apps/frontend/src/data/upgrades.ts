/**
 * Network upgrades, for Zcash Status and the taskbar's network flyout.
 * Facts from the ZIPs on GitHub (read 2026-10-04); dates reported in the
 * press are marked as such.
 */

export interface Upgrade {
  id: string;
  name: string;
  status: 'live' | 'scheduled' | 'planned';
  /** One line for the flyout. */
  line: string;
  changes: string[];
  forYou: string[];
  sources: { label: string; url: string }[];
}

export const UPGRADES: Upgrade[] = [
  {
    id: 'nu7', name: 'NU7', status: 'scheduled',
    line: 'Testnet at block 4,465,026. Mainnet height set Oct 20; Nov 5 is the reported target.',
    changes: [
      'Blocks every 25 seconds instead of 75, with limits on shielded actions per block (ZIP 218).',
      '60% of transaction fees removed from circulation (ZIP 235), with the Network Sustainability Mechanism (ZIP 237).',
      'Version 4 transactions become invalid (ZIP 2003). Sprout can only be spent with those, so Sprout funds become unspendable.',
      'No new transaction format. The ZEC supply cap does not change.',
    ],
    forYou: [
      'Still have ZEC in Sprout? Move it before activation.',
      'Keep your wallet app updated around the activation date.',
      'Run a node? Mainnet nodes must advertise protocol version 170190 or higher.',
      'Confirmations come about three times faster once it is live.',
    ],
    sources: [
      { label: 'ZIP 259: NU7 deployment (Draft)', url: 'https://github.com/zcash/zips/blob/main/zips/zip-0259.md' },
      { label: 'CoinDesk: Nov 5 target (2026-09-18)', url: 'https://www.coindesk.com/tech/2026/09/18/zcash-targets-november-upgrade-to-make-private-payments-up-to-three-times-faster' },
    ],
  },
  {
    id: 'ironwood', name: 'NU6.3 Ironwood', status: 'live',
    line: 'Live since 2026-07-28, block 3,428,143. Orchard is spend-only.',
    changes: [
      'A new shielded pool, Ironwood, after a soundness bug was found in Orchard. No exploitation has been reported.',
      'Orchard can be spent from but not paid into; wallets move funds across with scheduled transfers (ZIP 318).',
    ],
    forYou: [
      'Use an Ironwood-ready wallet, and let it finish moving your Orchard funds.',
      'The move is tracked on your device: reinstalling restarts it.',
    ],
    sources: [{ label: 'ZIP 318: pool migration', url: 'https://github.com/zcash/zips/blob/main/zips/zip-0318.md' }],
  },
];

/** Every settled upgrade, newest first. Heights from each deployment ZIP. */
export const HISTORY: { name: string; height: number; date: string; what: string; zip: string }[] = [
  { name: 'NU6.3 Ironwood', height: 3_428_143, date: '2026-07-28', what: 'New Ironwood shielded pool after the Orchard soundness bug; Orchard becomes spend-only.', zip: 'zip-0258.md' },
  { name: 'NU6.2', height: 3_364_600, date: '2026-05', what: 'Orchard temporary vulnerability mitigation.', zip: 'zip-0257.md' },
  { name: 'NU6.1', height: 3_146_400, date: '2025-11', what: 'Deferred dev fund lockbox disbursement (ZIP 271).', zip: 'zip-0255.md' },
  { name: 'NU6', height: 2_726_400, date: '2024-11', what: 'Lockbox for part of the dev fund; blocks must balance exactly (ZIP 236).', zip: 'zip-0253.md' },
  { name: 'NU5', height: 1_687_104, date: '2022-05', what: 'Orchard pool and Halo 2 proofs (no trusted setup), unified addresses, v5 transactions.', zip: 'zip-0252.rst' },
  { name: 'Canopy', height: 1_046_400, date: '2020-11', what: 'Dev fund replaces the Founders\' Reward; no new value into Sprout.', zip: 'zip-0251.rst' },
  { name: 'Heartwood', height: 903_000, date: '2020-07', what: 'Shielded coinbase; FlyClient support for light clients.', zip: 'zip-0250.rst' },
  { name: 'Blossom', height: 653_600, date: '2019-12', what: 'Block time cut from 150 to 75 seconds.', zip: 'zip-0206.rst' },
  { name: 'Sapling', height: 419_200, date: '2018-10', what: 'Sapling pool: shielded sends fast enough for phones.', zip: 'zip-0205.rst' },
];

/** Public light-wallet servers, from the ZecHub list (read 2026-10-04). Health is on hosh.zec.rocks. */
export const SERVERS: { host: string; note: string; kind: 'lightwalletd' | 'zaino' | 'testnet' }[] = [
  { host: 'zec.rocks:443', note: 'The main public server. Regional endpoints at na., eu., ap. and sa.zec.rocks.', kind: 'lightwalletd' },
  { host: 'zec-node.cakewallet.com:443', note: 'On Cake Wallet\'s domain.', kind: 'lightwalletd' },
  { host: 'zec.0xrpc.io:443', note: 'Run by 0xRPC, free and donation funded.', kind: 'lightwalletd' },
  { host: 'zaino.unsafe.zec.rocks:443', note: 'A Zaino instance. The hostname says it: experimental.', kind: 'zaino' },
  { host: 'testnet.zec.rocks:443', note: 'Testnet. A Zaino testnet instance is at zaino.testnet.unsafe.zec.rocks.', kind: 'testnet' },
];
