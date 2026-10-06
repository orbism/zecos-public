/**
 * Where you can move ZEC in and out, and which address types each venue
 * takes. Curated by hand: no exchange publishes this as a feed.
 *
 * Every row carries its sources and the date it was last checked. `null`
 * means unknown (not verified), never "no". Update a row by editing it and
 * bumping `lastChecked`; rows older than STALE_DAYS show a "may be stale"
 * badge in the Exchange Checker.
 *
 * First compiled 2026-10-04 from the ZecHub wiki (GitHub) and search results,
 * then corrected from the sysop's services table (official sources,
 * 2026-10-02), which wins where they disagree. Rows marked
 * `confidence: 'snippet'` or `'unverified'` deserve a browser check.
 */

export type VenueKind = 'exchange' | 'broker' | 'instant-swap' | 'dex';
export type Tri = boolean | null;

export interface RegionNote {
  region: string;
  status: 'available' | 'delisted' | 'unavailable' | 'ban-scheduled' | 'relisted';
  date: string | null;
  note: string;
}

export interface Venue {
  id: string;
  name: string;
  url: string;
  kind: VenueKind;
  deposit: {
    /** Deposit address the venue gives you. */
    issues: 'transparent' | 'tex' | 'shielded' | 'none' | null;
    /** Accepts funds SENT FROM a shielded wallet. false = it bounces or is rejected. */
    fromShielded: Tri;
  };
  withdraw: {
    transparent: Tri;
    shielded: Tri;
    /** The withdrawal form accepts a u1 unified address. */
    unified: Tri;
  };
  texRequired: boolean | null;
  depositTime: string | null;
  regions: RegionNote[];
  notes: string;
  confidence: 'official' | 'wiki' | 'snippet' | 'unverified';
  sources: { label: string; url: string }[];
  lastChecked: string;
}

export const STALE_DAYS = 60;

const ZH = { label: 'ZecHub: custodial exchanges', url: 'https://github.com/zechub/zechub/blob/main/site/Using_Zcash/Custodial_Exchanges.md' };
const ZHN = { label: 'ZecHub: non-custodial exchanges', url: 'https://github.com/zechub/zechub/blob/main/site/Using_Zcash/Non-Custodial_Exchanges.md' };
const ZHTEX = { label: 'ZecHub: TEX addresses', url: 'https://github.com/zechub/zechub/blob/main/site/Using_Zcash/Transparent_Exchange_Addresses.md' };
const EU = { region: 'EU', status: 'ban-scheduled' as const, date: '2027-07-10', note: 'AMLR (Reg. 2024/1624): regulated providers may not handle privacy coins from this date. Self-custody stays legal.' };
const D = '2026-10-04';

export const VENUES: Venue[] = [
  {
    id: 'gemini', name: 'Gemini', url: 'https://www.gemini.com', kind: 'exchange',
    deposit: { issues: 'transparent', fromShielded: true },
    withdraw: { transparent: true, shielded: true, unified: true },
    texRequired: false, depositTime: '~50 min',
    regions: [EU],
    notes: 'The only big exchange that withdraws straight into the shielded pool. Supported Ironwood from day one.',
    confidence: 'official',
    sources: [{ label: 'Gemini: move to Zakura', url: 'https://www.gemini.com/blog/gemini-preps-for-faster-zcash-with-move-to-zakura' }, ZH, { label: 'Gemini: Zcash deposit address type', url: 'https://support.gemini.com/hc/en-us/articles/31670107364891-What-type-of-Zcash-deposit-address-does-Gemini-issue' }],
    lastChecked: D,
  },
  {
    id: 'binance', name: 'Binance', url: 'https://www.binance.com', kind: 'exchange',
    deposit: { issues: 'tex', fromShielded: false },
    withdraw: { transparent: true, shielded: false, unified: null },
    texRequired: true, depositTime: '~20 min',
    regions: [
      { region: 'UAE (Binance FZE, Dubai)', status: 'unavailable', date: '2025-04-25', note: 'VARA rules ban anonymity-enhanced coins.' },
      { region: 'France, Spain, Italy, Poland', status: 'available', date: '2023-06', note: 'A May 2023 delisting notice was later reversed for ZEC.' },
      EU,
    ],
    notes: 'Supported the 2026-07-28 Ironwood upgrade on the native Zcash network. Gives you a TEX deposit address: funds must come from a transparent address, and deposits sent from a shielded address are rejected and refunded (one report says refunds took up to ~30 days). Binance does not document shielded support itself.',
    confidence: 'wiki',
    sources: [{ label: 'Binance: Ironwood upgrade notice', url: 'https://www.binance.com/en-NG/support/announcement/detail/5f6b47cf7cfa46c58b74d5c6d2717632' }, ZH, ZHTEX, { label: 'Forum: Binance rejecting shielded deposits', url: 'https://forum.zcashcommunity.com/t/binance-rejecting-deposits-from-zcash-shielded-addresses/47667' }],
    lastChecked: D,
  },
  {
    id: 'coinbase', name: 'Coinbase', url: 'https://www.coinbase.com', kind: 'exchange',
    deposit: { issues: 'transparent', fromShielded: true },
    withdraw: { transparent: true, shielded: false, unified: false },
    texRequired: false, depositTime: '~150 min',
    regions: [EU],
    notes: 'Receives ZEC sent from shielded or transparent addresses; withdraws to transparent addresses only.',
    confidence: 'official',
    sources: [{ label: 'Coinbase: Zcash', url: 'https://www.coinbase.com/price/zcash' }, ZH],
    lastChecked: D,
  },
  {
    id: 'kraken', name: 'Kraken', url: 'https://www.kraken.com', kind: 'exchange',
    deposit: { issues: 'transparent', fromShielded: null },
    withdraw: { transparent: true, shielded: false, unified: false },
    texRequired: false, depositTime: '~60 min',
    regions: [
      { region: 'India', status: 'delisted', date: '2026-04-10', note: 'Deposits and trading halted 2026-04-10, withdrawals 2026-05-15, balances liquidated 05-18 to 05-22.' },
      { region: 'UAE', status: 'delisted', date: '2026-06-16', note: 'Deposits and trading halted 2026-06-16, withdrawals 2026-09-14, balances liquidated 09-15 to 09-25.' },
      EU,
    ],
    notes: 'Withdrawal form takes t-addresses only; shielded zs and zc addresses are not supported.',
    confidence: 'official',
    sources: [{ label: 'Kraken: withdrawal address formats', url: 'https://support.kraken.com/articles/360001474826-supported-address-formats-for-cryptocurrency-withdrawal' }, ZH, { label: 'Kraken: UAE delistings', url: 'https://support.kraken.com/articles/notice-of-delistings-uae' }, { label: 'Kraken: India delistings', url: 'https://support.kraken.com/articles/asset-delistings-india' }],
    lastChecked: D,
  },
  {
    id: 'robinhood', name: 'Robinhood', url: 'https://robinhood.com', kind: 'broker',
    deposit: { issues: 'none', fromShielded: null },
    withdraw: { transparent: true, shielded: false, unified: false },
    texRequired: false, depositTime: null,
    regions: [EU],
    notes: 'ZEC deposits are not supported. Withdrawals to t-addresses only; shielded and unified destinations are not supported.',
    confidence: 'official', sources: [{ label: 'Robinhood: crypto transfers', url: 'https://robinhood.com/us/en/support/articles/crypto-transfers/' }, ZH], lastChecked: D,
  },
  {
    id: 'okx', name: 'OKX', url: 'https://www.okx.com', kind: 'exchange',
    deposit: { issues: 'transparent', fromShielded: null },
    withdraw: { transparent: true, shielded: false, unified: null },
    texRequired: false, depositTime: '~25 min',
    regions: [{ region: 'Global', status: 'relisted', date: '2025-11-23', note: 'Delisted Jan 2024, relisted Nov 2025.' }, EU],
    notes: 'Transparent only.', confidence: 'wiki',
    sources: [ZH, { label: 'OKX: ZEC listing', url: 'https://www.okx.com/en-us/help/okx-to-list-zcash-zec-for-spot-trading' }], lastChecked: D,
  },
  {
    id: 'kucoin', name: 'KuCoin', url: 'https://www.kucoin.com', kind: 'exchange',
    deposit: { issues: 'none', fromShielded: null }, withdraw: { transparent: false, shielded: false, unified: false },
    texRequired: null, depositTime: null,
    regions: [{ region: 'Global', status: 'delisted', date: '2025-09-03', note: 'ZEC delisted 2025-09-03; withdrawals closed 2025-10-03.' }],
    notes: 'No longer lists ZEC.', confidence: 'official',
    sources: [{ label: 'KuCoin: delisting notice', url: 'https://www.kucoin.com/en-au/announcement/en-st-kucoin-will-delist-certain-projects-and-their-associated-tokens-0902' }], lastChecked: D,
  },
  {
    id: 'bitfinex', name: 'Bitfinex', url: 'https://www.bitfinex.com', kind: 'exchange',
    deposit: { issues: 'transparent', fromShielded: null }, withdraw: { transparent: true, shielded: false, unified: null },
    texRequired: false, depositTime: '~25 min', regions: [], notes: 'Zcash mainnet transfers. Shielded support not verified (ZecHub lists transparent only).', confidence: 'wiki', sources: [{ label: 'Bitfinex: Zcash', url: 'https://support.bitfinex.com/hc/en-us/articles/115003290425-Zcash-ZEC' }, ZH], lastChecked: D,
  },
  {
    id: 'htx', name: 'HTX (Huobi)', url: 'https://www.htx.com', kind: 'exchange',
    deposit: { issues: 'transparent', fromShielded: null }, withdraw: { transparent: true, shielded: false, unified: null },
    texRequired: false, depositTime: '~35 min', regions: [], notes: 'Transparent only.', confidence: 'wiki', sources: [ZH], lastChecked: D,
  },
  {
    id: 'bitpanda', name: 'Bitpanda', url: 'https://www.bitpanda.com', kind: 'broker',
    deposit: { issues: 'transparent', fromShielded: null }, withdraw: { transparent: true, shielded: false, unified: null },
    texRequired: false, depositTime: null, regions: [EU], notes: 'Transparent only, per an aggregator listing.', confidence: 'snippet',
    sources: [{ label: 'Bitpanda: Zcash', url: 'https://www.bitpanda.com/en/prices/zcash-zec' }], lastChecked: D,
  },
  {
    id: 'backpack', name: 'Backpack', url: 'https://backpack.exchange', kind: 'exchange',
    deposit: { issues: null, fromShielded: null }, withdraw: { transparent: null, shielded: null, unified: null },
    texRequired: null, depositTime: null, regions: [],
    notes: 'ZEC spot and perps. Deposits and withdrawals enabled; address types not stated.', confidence: 'wiki', sources: [ZH], lastChecked: D,
  },
  {
    id: 'bitget', name: 'Bitget', url: 'https://www.bitget.com', kind: 'exchange',
    deposit: { issues: 'none', fromShielded: null }, withdraw: { transparent: false, shielded: false, unified: false },
    texRequired: null, depositTime: null, regions: [],
    notes: 'Its Zcash page now says "Not listed". Older 2026 deposit and withdrawal notices are not evidence of a current listing.',
    confidence: 'official', sources: [{ label: 'Bitget: Zcash', url: 'https://www.bitget.com/how-to-buy/zcash' }], lastChecked: D,
  },
  ...(['Bybit|https://www.bybit.com', 'Crypto.com|https://crypto.com'] as const).map((s) => {
    const [name, url] = s.split('|') as [string, string];
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]/g, ''), name, url, kind: (name === 'Crypto.com' ? 'broker' : 'exchange') as VenueKind,
      deposit: { issues: null, fromShielded: null }, withdraw: { transparent: null, shielded: null, unified: null },
      texRequired: null, depositTime: null, regions: [],
      notes: 'Lists ZEC; address types not verified yet.', confidence: 'unverified' as const, sources: [], lastChecked: D,
    };
  }),
  ...([
    ['gate', 'Gate', 'https://www.gate.com/trade/ZEC_USDT', 'ZEC/USDT spot market live.'],
    ['mexc', 'MEXC', 'https://www.mexc.com/exchange/ZEC_USDT', 'ZEC spot markets live.'],
    ['poloniex', 'Poloniex', 'https://www.poloniex.com/how-to-buy/detail/ZEC', 'ZEC trading live.'],
    ['coindcx', 'CoinDCX', 'https://coindcx.com/how-to-buy/zcash-zec/', 'India. ZEC buy and trade live.'],
  ] as const).map(([id, name, url, live]) => ({
    id, name, url, kind: 'exchange' as VenueKind,
    deposit: { issues: null, fromShielded: null }, withdraw: { transparent: null, shielded: null, unified: null },
    texRequired: null, depositTime: null, regions: [],
    notes: `${live} Native transfer details and shielded support not verified.`, confidence: 'unverified' as const,
    sources: [{ label: `${name}: ZEC`, url }], lastChecked: '2026-10-02',
  })),
  {
    id: 'kr-exchanges', name: 'Upbit, Bithumb (South Korea)', url: 'https://upbit.com', kind: 'exchange',
    deposit: { issues: 'none', fromShielded: null }, withdraw: { transparent: false, shielded: false, unified: false },
    texRequired: null, depositTime: null,
    regions: [{ region: 'South Korea', status: 'delisted', date: '2019-09-30', note: 'Upbit delisted citing FATF / AML rules; others followed.' }],
    notes: 'No ZEC.', confidence: 'snippet',
    sources: [{ label: 'Crowdfund Insider (2019)', url: 'https://www.crowdfundinsider.com/2019/09/151844-citing-money-laundering-concerns-south-korean-exchange-upbit-delists-privacy-coins-monero-xmr-zcash-zec-dash/' }], lastChecked: D,
  },
  {
    id: 'jp-exchanges', name: 'Japanese licensed exchanges', url: 'https://coincheck.com', kind: 'exchange',
    deposit: { issues: 'none', fromShielded: null }, withdraw: { transparent: false, shielded: false, unified: false },
    texRequired: null, depositTime: null,
    regions: [{ region: 'Japan', status: 'delisted', date: '2018', note: 'FSA pressure on anonymity coins.' }],
    notes: 'No ZEC.', confidence: 'snippet', sources: [], lastChecked: D,
  },
  {
    id: 'bitcoinvn', name: 'BitcoinVN', url: 'https://bitcoinvn.io', kind: 'instant-swap',
    deposit: { issues: 'shielded', fromShielded: true }, withdraw: { transparent: true, shielded: true, unified: null },
    texRequired: false, depositTime: 'instant', regions: [],
    notes: 'Swaps into and out of shielded ZEC (verified May 2026). Ironwood compatibility not separately documented.', confidence: 'official', sources: [{ label: 'BitcoinVN: shielded Zcash', url: 'https://bitcoinvn.io/insights/zcash-vs-shielded-zcash-bitcoinvn/' }, ZH], lastChecked: D,
  },
  {
    id: 'sideshift', name: 'SideShift', url: 'https://sideshift.ai', kind: 'instant-swap',
    deposit: { issues: 'shielded', fromShielded: true }, withdraw: { transparent: true, shielded: true, unified: null },
    texRequired: false, depositTime: null, regions: [],
    notes: 'Has a dedicated shielded (zaddr) route for Sapling.', confidence: 'snippet',
    sources: [{ label: 'SideShift: shielded ZEC', url: 'https://medium.com/sideshift-ai/integrating-zcash-shielded-transactions-on-sideshift-ai-d2982bba2b52' }], lastChecked: D,
  },
  {
    id: 'ghostswap', name: 'GhostSwap', url: 'https://ghostswap.io', kind: 'instant-swap',
    deposit: { issues: 'transparent', fromShielded: null }, withdraw: { transparent: true, shielded: true, unified: null },
    texRequired: false, depositTime: null, regions: [],
    notes: 'Supports t and z payout addresses, recommends t.', confidence: 'snippet',
    sources: [{ label: 'GhostSwap: Zcash', url: 'https://ghostswap.io/zcash-exchange/' }], lastChecked: D,
  },
  {
    id: 'stealthex', name: 'StealthEX', url: 'https://stealthex.io', kind: 'instant-swap',
    deposit: { issues: 'transparent', fromShielded: null }, withdraw: { transparent: true, shielded: null, unified: null },
    texRequired: false, depositTime: null, regions: [],
    notes: 'ZEC swaps. Says shielded use needs a compatible wallet, but does not explicitly claim shielded delivery.', confidence: 'official',
    sources: [{ label: 'StealthEX: Zcash', url: 'https://stealthex.io/coin/zcash/' }], lastChecked: D,
  },
  {
    id: 'changenow', name: 'ChangeNOW', url: 'https://changenow.io/currencies/zcash', kind: 'instant-swap',
    deposit: { issues: 'transparent', fromShielded: null }, withdraw: { transparent: true, shielded: null, unified: null },
    texRequired: false, depositTime: null, regions: [],
    notes: 'Native Zcash listed. Shielded delivery not explicitly claimed.', confidence: 'official',
    sources: [{ label: 'ChangeNOW: Zcash', url: 'https://changenow.io/currencies/zcash' }], lastChecked: '2026-10-02',
  },
  {
    id: 'leodex', name: 'LeoDex', url: 'https://leodex.io', kind: 'dex',
    deposit: { issues: 'shielded', fromShielded: true }, withdraw: { transparent: true, shielded: true, unified: true },
    texRequired: false, depositTime: null, regions: [],
    notes: 'Routes through Maya and NEAR Intents. Delivers straight to shielded u1 addresses and swaps out of shielded ZEC. Explicitly Ironwood ready.', confidence: 'official',
    sources: [{ label: 'LeoDex: ZEC', url: 'https://leodex.io/asset/ZEC.ZEC' }, { label: 'LeoDex: Ironwood guide', url: 'https://leodex.io/learn/guides/zcash-ironwood' }], lastChecked: D,
  },
  {
    id: 'near-intents', name: 'NEAR Intents (1Click)', url: 'https://near-intents.org', kind: 'dex',
    deposit: { issues: 'transparent', fromShielded: null }, withdraw: { transparent: true, shielded: false, unified: false },
    texRequired: false, depositTime: null, regions: [],
    notes: 'ZEC on transparent addresses only. AML screening can delay, block or hold a swap. Always give a refund address you control.',
    confidence: 'wiki', sources: [ZHN], lastChecked: D,
  },
  {
    id: 'maya', name: 'Maya Protocol', url: 'https://www.mayaprotocol.com', kind: 'dex',
    deposit: { issues: 'transparent', fromShielded: null }, withdraw: { transparent: true, shielded: true, unified: null },
    texRequired: false, depositTime: null, regions: [],
    notes: 'Native ZEC since May 2025; shielded payouts via memo added later (used by Edge).', confidence: 'snippet',
    sources: [{ label: 'Edge: private Zcash swaps with Maya', url: 'https://edge.app/blog/company-news/private-zcash-swaps-edge-maya-protocol/' }], lastChecked: D,
  },
  {
    id: 'thorchain', name: 'THORChain', url: 'https://thorchain.org', kind: 'dex',
    deposit: { issues: null, fromShielded: null }, withdraw: { transparent: null, shielded: null, unified: null },
    texRequired: false, depositTime: null, regions: [],
    notes: 'ZEC pool opened 2026-10-02; trading not live yet at last check.', confidence: 'snippet',
    sources: [{ label: 'crypto.news: THORChain ZEC pool', url: 'https://crypto.news/thorchain-launches-zcash-pool-trading-comes-next/' }], lastChecked: D,
  },
];

/** Rules that apply across venues, shown above the list. */
export const GLOBAL_RULES: { title: string; body: string; url: string }[] = [
  { title: 'EU, from 2027-07-10', body: 'Regulated providers may not list, hold or service privacy coins (AMLR). Holding your own ZEC stays legal.', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A32024R1624' },
  { title: 'Dubai', body: 'DFSA ban on privacy coins in the DIFC from 2026-01-12; VARA has banned anonymity-enhanced coins since 2023.', url: 'https://news.bitcoin.com/from-surge-to-shutdown-dubai-blocks-privacy-coins-in-2026/' },
  { title: 'India', body: 'A privacy-coin directive was reported in Jan 2026; the FIU said on 2026-03-10 it had issued no formal order. Kraken delisted ZEC there anyway.', url: 'https://support.kraken.com/articles/asset-delistings-india' },
];
