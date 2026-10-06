/**
 * Pure app metadata - NO component references.
 *
 * Kept free of imports so Server Components (the standalone `/<app>` route's
 * generateMetadata / generateStaticParams / 404) can read it. `appRegistry.ts`
 * joins this with the actual components, which are client-only
 * (`dynamic(..., { ssr: false })` cannot be imported from a Server Component).
 *
 * `type` always equals `id`, so it is derived rather than repeated.
 */

/**
 * `rings` is the collectibles category - Pools and anything that comes after it.
 *
 * Its own category rather than sitting under `privacy`, because a collection is
 * not a privacy tool: it is a thing you own. Named for the asset class rather
 * than the app, so a second collection has somewhere obvious to go.
 */
export type AppCategory = 'stats' | 'charts' | 'games' | 'privacy' | 'tools' | 'widgets' | 'rings' | 'education' | 'media' | 'system';

/**
 * How an app behaves at its standalone route (`/<id>`).
 *  - 'simple' (default) - rendered full-viewport in StandaloneShell.
 *  - 'tiled'            - rendered by TileHost, which tiles any child windows
 *                         the app spawns (Explorer's hash-click flow).
 *  - false              - no standalone route; `/<id>` 404s.
 */
export type StandaloneMode = 'simple' | 'tiled' | false;

export interface AppMeta {
  id: string;
  title: string;
  icon: string;
  defaultSize: { width: number; height: number };
  minSize?: { width: number; height: number };
  category?: AppCategory;
  /**
   * A real mark, where the app has one.
   *
   * `icon` stays as the fallback: it is a single character, so it works in the
   * terminal, in a plain-text menu, and anywhere an image cannot load. An app
   * with a logo uses the image where images are possible and the glyph
   * everywhere else, rather than replacing one with the other.
   */
  logo?: string;
  adminOnly?: boolean; // only listed for the verified sysop (and a sudobud, see adminAppVisible)
  /** Opens against this edge of the desktop, however it is launched (a buddy list lives on the right). */
  dock?: 'right' | 'center';
  standalone?: StandaloneMode;
  /** 4-6 words. Shown inline in the Registry app. */
  blurb?: string;
  /** 1-2 sentences. Shown in the Registry's detail popover. */
  about?: string;
  /**
   * A beta app: carries the BETA tag everywhere it is shown, and runs as a
   * preview on sample data until the sysop switches it live (betaStore).
   */
  beta?: boolean;
  /** Beta but open: keeps the BETA tag and the experimental note, with no preview gate. */
  betaOpen?: boolean;
}

export const APP_META: AppMeta[] = [
  // Reached from the 📮 trigger beside the coffee cup, not from a desktop icon.
  // `standalone: false` - the standalone routes show it as a blocking overlay
  // (FeedbackModal) rather than a page of its own.
  {
    id: 'feedback', title: 'Suggestion Box', icon: '📮',
    defaultSize: { width: 480, height: 640 }, minSize: { width: 360, height: 460 },
    category: 'system', standalone: false,
    blurb: 'Send a bug report or idea',
    about: 'Sends a short note straight to the sysop - bug, suggestion, or collaboration. Contact details are optional.',
  },
  // Stats
  {
    id: 'price-ticker', title: 'ZEC Price', icon: '💰',
    defaultSize: { width: 360, height: 260 }, minSize: { width: 240, height: 160 }, category: 'stats',
    blurb: 'Live ZEC/USD spot price',
    about: 'Current ZEC price in USD, taken from a median of exchange tickers rather than a single aggregator. Updates continuously.',
  },
  {
    id: 'block-height', title: 'Block Height', icon: '📦',
    defaultSize: { width: 360, height: 260 }, minSize: { width: 240, height: 160 }, category: 'stats',
    blurb: 'Current chain tip height',
    about: 'The height of the latest block our node has seen. The simplest answer to "is the chain moving?"',
  },
  {
    id: 'difficulty', title: 'Difficulty', icon: '⚡',
    defaultSize: { width: 380, height: 260 }, minSize: { width: 260, height: 160 }, category: 'stats',
    blurb: 'Network mining difficulty now',
    about: 'How hard it currently is to mine a Zcash block. Difficulty retargets to keep block times steady as hashrate moves.',
  },
  {
    id: 'transparent-pool', title: 'Transparent Pool', icon: '🔓',
    defaultSize: { width: 380, height: 260 }, minSize: { width: 260, height: 160 }, category: 'stats',
    blurb: 'ZEC held in transparent addresses',
    about: 'Total value sitting in transparent (t-address) form, where amounts and addresses are publicly visible.',
  },
  {
    id: 'shielded-pool', title: 'Shielded Pool', icon: '🛡️',
    defaultSize: { width: 400, height: 300 }, minSize: { width: 280, height: 180 }, category: 'stats',
    blurb: 'Total value held shielded',
    about: 'Combined value across Sprout, Sapling, Orchard and Ironwood. Excludes the lockbox, which is not a shielded pool.',
  },
  {
    id: 'shielded-pools', title: 'Shielded Pools', icon: '🏊',
    defaultSize: { width: 380, height: 380 }, minSize: { width: 300, height: 260 }, category: 'stats',
    blurb: 'Every pool balance at once',
    about: 'A breakdown of value across all pools - transparent, Sprout, Sapling, Orchard, Ironwood and the lockbox.',
  },
  {
    id: 'total-supply', title: 'Total Supply', icon: '💎',
    defaultSize: { width: 360, height: 340 }, minSize: { width: 280, height: 220 }, category: 'stats',
    blurb: 'All ZEC in circulation',
    about: 'Every ZEC that exists, shielded and transparent combined, including the NU6 deferred dev-fund lockbox.',
  },
  {
    id: 'total-shielded', title: 'Total Shielded', icon: '🔒',
    defaultSize: { width: 360, height: 340 }, minSize: { width: 280, height: 220 }, category: 'stats',
    blurb: 'Sum of all shielded pools',
    about: 'Total ZEC protected by shielded pools. The lockbox is deliberately excluded - it counts toward supply, not privacy.',
  },
  {
    id: 'shielded-percent', title: 'Shielded %', icon: '📉',
    defaultSize: { width: 360, height: 380 }, minSize: { width: 280, height: 240 }, category: 'stats',
    blurb: 'Share of supply that is shielded',
    about: 'What fraction of all ZEC is currently held privately. Arguably the single most telling number about Zcash.',
  },
  {
    id: 'total-txs', title: 'Total TXs', icon: '🧾',
    defaultSize: { width: 340, height: 320 }, minSize: { width: 260, height: 200 }, category: 'stats',
    blurb: 'Shield and deshield operations, last 30 days',
    about: 'Every transaction ever confirmed on the Zcash chain, counted end to end.',
  },

  // Mining
  {
    id: 'mining', title: 'Mining', icon: '⛏',
    defaultSize: { width: 1200, height: 960 }, minSize: { width: 760, height: 580 }, category: 'tools',
    blurb: 'Miner shares, pools and timeline',
    about: 'Who is producing blocks, at what share, and how that has shifted over time. Mining rewards are transparent, so this is directly observable.',
  },

  // Charts
  {
    id: 'price-chart', title: 'Price Chart', icon: '📈',
    defaultSize: { width: 640, height: 660 }, minSize: { width: 440, height: 420 }, category: 'charts',
    blurb: 'ZEC price history over time',
    about: 'Historical ZEC/USD across ranges from a day to the full record, with pixel and clean rendering styles.',
  },
  {
    id: 'shielded-chart', title: 'Shielded Chart', icon: '📗',
    defaultSize: { width: 640, height: 660 }, minSize: { width: 440, height: 420 }, category: 'charts',
    blurb: 'Shielded value over time',
    about: 'How much ZEC has been held privately through history, priced in ZEC or USD. Lockbox value is excluded throughout.',
  },
  {
    id: 'shielded-pools-chart', title: 'Shielded Pools Chart', icon: '🌊',
    defaultSize: { width: 680, height: 700 }, minSize: { width: 480, height: 440 }, category: 'charts',
    blurb: 'All pool balances, side by side',
    about: 'Sprout, Sapling, Orchard and Ironwood plotted together so you can watch value migrate between pools. Each series toggles independently.',
  },
  {
    id: 'supply-chart', title: 'Supply Chart', icon: '💵',
    defaultSize: { width: 640, height: 660 }, minSize: { width: 440, height: 420 }, category: 'charts',
    blurb: 'Total supply history and value',
    about: 'Circulating supply over time, viewable in ZEC or in dollar terms against historical price.',
  },

  // Tools
  {
    id: 'about', title: 'About ZEC-OS', icon: 'ℹ️',
    defaultSize: { width: 660, height: 680 }, minSize: { width: 440, height: 460 }, category: 'system',
    blurb: 'What this is and who built it',
    about: 'Background on ZEC-OS, the stack behind it, and the node infrastructure serving the data you see.',
  },
  {
    id: 'zim', title: 'ZIM', icon: '🏃',
    defaultSize: { width: 300, height: 560 }, minSize: { width: 260, height: 420 }, category: 'tools',
    standalone: 'tiled', // conversations open as panes beside the buddy list
    dock: 'right',
    blurb: 'Zcash Instant Messenger',
    about: 'Instant messages between verified ZEC-OS accounts. Share your buddy link, accept requests, and chat. Buddies see your name and picture, never your address.',
  },
  // A ZIM conversation. Opened from the buddy list, never on its own: no category, no route.
  {
    id: 'zim-chat', title: 'Instant Message', icon: '💬',
    defaultSize: { width: 440, height: 500 }, minSize: { width: 320, height: 340 }, standalone: false,
  },
  {
    id: 'system-tutorial', title: 'System Tutorial', icon: '🧭',
    defaultSize: { width: 320, height: 200 }, category: 'system',
    standalone: false, // drives the desktop itself - there is nothing to show on its own
    blurb: 'A guided tour of ZEC-OS',
    about: 'A one-minute walkthrough of the desktop: the Z menu, folders, Explorer, windows, network status, settings, the block ticker and the coffee fund. It plays itself; Exit tutorial stops it any time.',
  },
  {
    id: 'settings', title: 'System Settings', icon: '⚙️',
    defaultSize: { width: 500, height: 660 }, minSize: { width: 360, height: 480 }, category: 'system',
    standalone: false, // configures the desktop itself - meaningless standalone
    blurb: 'Desktop preferences and options',
    about: 'Font sizes, icon styles, sound and other desktop-wide preferences.',
  },
  {
    id: 'hindsight', title: 'Hindsight', icon: '💸',
    defaultSize: { width: 900, height: 820 }, minSize: { width: 560, height: 520 }, category: 'tools',
    blurb: 'What that ZEC buy is worth now',
    about: 'Enter what you put into ZEC and when - in USD, ETH or BTC - and see what it would be worth today, charted from the purchase date with peaks, drawdowns and a comparison against simply holding the ETH or BTC.',
  },
  {
    id: 'calculator', title: 'Calculator', icon: '🔢',
    defaultSize: { width: 300, height: 460 }, minSize: { width: 220, height: 320 }, category: 'system',
    blurb: 'A plain working calculator',
    about: 'Exactly what it looks like. Sometimes you just need to do some arithmetic without leaving the desk.',
  },
  {
    id: 'themes', title: 'Themes', icon: '🎨',
    defaultSize: { width: 500, height: 660 }, minSize: { width: 380, height: 480 }, category: 'system',
    standalone: false, // configures the desktop itself - meaningless standalone
    blurb: 'Switch the desktop look',
    about: 'Pick from era-spanning skins - modern black glass through to 90s beige and CRT green.',
  },
  {
    id: 'terminal', title: 'Terminal', icon: '💻',
    defaultSize: { width: 720, height: 600 }, minSize: { width: 480, height: 360 }, category: 'tools',
    blurb: 'Query the chain by command',
    about: 'A text shell for pulling chain data directly. Type `help` to see what it knows.',
  },
  {
    id: 'explorer', title: 'Explorer', icon: '🔍',
    defaultSize: { width: 860, height: 880 }, minSize: { width: 580, height: 580 }, category: 'tools',
    standalone: 'tiled', // hash clicks spawn sibling panes
    blurb: 'Search blocks, transactions, addresses',
    about: 'The full block explorer. Clicking any hash opens it in a new pane beside the current one, so you can follow a trail without losing your place.',
  },
  {
    id: 'ua-decoder', title: 'Address Decoder', icon: '🔓',
    defaultSize: { width: 740, height: 700 }, minSize: { width: 520, height: 480 }, category: 'tools',
    blurb: 'Break down a unified address',
    about: 'Paste any Zcash address to see which receiver types it carries and what each component encodes.',
  },
  {
    id: 'exchange-checker', title: 'Exchange Checker', icon: '🏦',
    defaultSize: { width: 760, height: 820 }, minSize: { width: 420, height: 480 }, category: 'tools',
    blurb: 'Will this exchange take my address?',
    about: 'Before you send: which exchanges and swaps take shielded, unified or TEX addresses, where ZEC is delisted, and a t1 to TEX converter. Every row shows its sources and when it was last checked.',
  },
  {
    id: 'pay-me', title: 'Pay Me', icon: '🪙',
    defaultSize: { width: 720, height: 820 }, minSize: { width: 440, height: 480 }, category: 'tools',
    blurb: 'Your own ZEC payment page',
    about: 'A payment page at zec-os.com/pay/your-name: an amount, a private note, a QR and a wallet link. ZEC-OS never holds the money: people pay you directly.',
  },
  {
    id: 'zcash-status', title: 'Zcash Status', icon: '🚦',
    defaultSize: { width: 720, height: 800 }, minSize: { width: 400, height: 440 }, category: 'tools',
    blurb: 'Is it me or Zcash?',
    about: 'The network as ZEC-OS sees it, every network upgrade from Sapling to NU7, whether your wallet, hardware or exchange is ready, and the public light-wallet servers and what they can see.',
  },
  {
    id: 'account', title: 'Account', icon: '👤',
    defaultSize: { width: 620, height: 640 }, minSize: { width: 460, height: 480 }, category: 'system',
    blurb: 'Your profile and saved state',
    about: 'Sign-in status, profile details, and the settings that follow you between sessions.',
  },
  {
    id: 'watchlist', title: 'Watchlist', icon: '👁',
    defaultSize: { width: 680, height: 720 }, minSize: { width: 480, height: 480 }, category: 'tools',
    blurb: 'Track addresses you care about',
    about: 'Keep a list of addresses and watch their activity. Saved to your account so it persists.',
  },
  {
    id: 'block-comparison', title: 'Block Comparison', icon: '⚖️',
    defaultSize: { width: 900, height: 780 }, minSize: { width: 620, height: 520 }, category: 'tools',
    blurb: 'Compare two blocks directly',
    about: 'Put two blocks side by side and diff their contents, size, timing and composition.',
  },

  // Privacy
  {
    id: 'privacy-weather', title: 'Privacy Weather', icon: '🌤️',
    defaultSize: { width: 540, height: 700 }, minSize: { width: 400, height: 520 }, category: 'privacy',
    blurb: 'Is now a good shielding moment',
    about: 'A weather-style read on current network conditions for shielding, based on flow ratios and recent activity.',
  },
  {
    id: 'privacy-coach', title: 'Privacy Coach', icon: '🛡️',
    defaultSize: { width: 600, height: 780 }, minSize: { width: 440, height: 580 }, category: 'privacy',
    blurb: 'Guidance on using pools well',
    about: 'Reads how pools are being used and suggests concrete habits that improve your privacy posture.',
  },
  {
    id: 'privacy-flow-chart', title: 'Flow History', icon: '📊',
    defaultSize: { width: 680, height: 600 }, minSize: { width: 520, height: 400 }, category: 'privacy',
    blurb: 'Shielding and deshielding over time',
    about: 'Value crossing the turnstile in both directions, plus shielded operation counts per pool.',
  },
  {
    id: 'slipstream', title: 'Slipstream', icon: '🌀',
    defaultSize: { width: 1080, height: 900 }, minSize: { width: 720, height: 560 }, category: 'privacy',
    blurb: 'Value moving between shielded pools',
    about: 'Watch ZEC migrate between Sprout, Sapling, Orchard and Ironwood - an animated cloud of the drift, live block settlement, adoption velocity and pool leaderboards. Shielded holders are never claimed to be identifiable.',
  },


  // Education
  {
    id: 'zendro', title: 'Zendrochronology', icon: '🪵',
    // A flight, not a panel: big by default. Tiled standalone so Explorer windows open beside it.
    defaultSize: { width: 1320, height: 860 }, minSize: { width: 720, height: 520 }, category: 'education',
    standalone: 'tiled',
    blurb: 'Zcash history, read like tree rings',
    about: 'Fly the hollow trunk of Zcash history from 1983 to today: stop at each event, read it, then step into its branch for the people, sources and on-chain proof. Every block height and hash opens in the Explorer.',
  },
  {
    id: 'zendrospiracies', title: 'Zendrospiracies', icon: '👁️',
    defaultSize: { width: 1320, height: 860 }, minSize: { width: 720, height: 520 }, category: 'education',
    standalone: 'tiled',
    blurb: 'The stranger rings of Zcash',
    about: 'Zendro\'s trunk, grown from the conspiracy theories that have followed Zcash. Every theory is sourced to where it was said online. Sourced, not endorsed.',
  },

  // Media
  {
    id: 'zecamp', title: 'zecAmp', icon: '⚡', logo: '/zecamp/logo.svg',
    // The classic player's native 275 units, zoomed 1.5x; the playlist takes the rest of the height.
    defaultSize: { width: 412, height: 700 }, minSize: { width: 275, height: 140 }, category: 'media',
    blurb: 'It really whips the zebra',
    about: 'A music player in the spirit of the classic one: equaliser, playlist, visualiser and three skins. Plays what ships with ZEC-OS, and any mp3s you drop in, which stay in this tab only. Minimise it and it keeps playing in the bottom bar; close it and the music stops.',
  },

  // Opened from zecAmp's MILKDROP button, never from a menu (no category), and only
  // on the desktop: standalone, zecAmp shows it over itself instead.
  {
    id: 'milkdrop', title: 'Milkdrop', icon: '🌀',
    defaultSize: { width: 720, height: 480 }, minSize: { width: 320, height: 220 }, standalone: false,
    blurb: 'zecAmp, as liquid light',
    about: 'The classic Milkdrop visualiser (butterchurn), dancing to whatever zecAmp is playing. Arrows change the preset, double-click goes fullscreen.',
  },

  // Sysop-only
  {
    id: 'system-debugger', title: 'System Debugger', icon: '🩺',
    defaultSize: { width: 860, height: 760 }, minSize: { width: 520, height: 420 }, category: 'system', adminOnly: true,
    blurb: 'Traffic and errors through the backend',
    about: 'Sysop view of requests per minute over the last hour, the busiest routes, and recent error logs. Route patterns and timings only: no IPs, users or request contents. In memory; resets on restart.',
  },
  {
    id: 'moderation', title: 'Moderation', icon: '🛡️',
    defaultSize: { width: 720, height: 680 }, minSize: { width: 460, height: 400 }, category: 'system', adminOnly: true,
    blurb: 'Freeze accounts and hand out badges',
    about: 'Sysop tool: find an account by handle, freeze or unfreeze it, grant or revoke badges, and create new ones. Shows handles, join dates and badges only.',
  },

  // Games
  {
    id: 'zeometry', title: 'Zeometry Wars', icon: '◇',
    defaultSize: { width: 1120, height: 760 }, minSize: { width: 720, height: 500 }, category: 'games',
    blurb: 'Neon twin-stick shooter, online co-op',
    about: 'Geometry Wars for ZEC-OS: shoot the surveillance, shield the notes. A different ship every run. Solo score attack with a weekly leaderboard, and online co-op and versus with your verified ZIM buddies.',
  },
  {
    id: 'shmup', title: 'Shmup', icon: '🚀',
    defaultSize: { width: 680, height: 840 }, minSize: { width: 600, height: 760 }, category: 'games',
    blurb: 'Vertical scrolling shooter',
    about: 'A arcade-style shoot-em-up. Scores can feed into tournament contests.',
  },
  {
    id: 'zkyline', title: 'Zkyline', icon: '🏙️',
    // Wide: a runner wants to see what is coming.
    defaultSize: { width: 1120, height: 680 }, minSize: { width: 480, height: 300 }, category: 'games',
    blurb: 'Psychedelic rooftop runner',
    about: 'Run the rooftops, alleys and markets of a city that is different every time. Jump, double jump, slide, and never get caught. The longer you last, the faster it goes and the stranger the colours get. Weekly and all-time boards for verified accounts.',
  },
  {
    id: 'pong', title: 'Pong', icon: '🏓',
    defaultSize: { width: 440, height: 400 }, minSize: { width: 420, height: 360 }, category: 'games',
    blurb: 'The original, still undefeated',
    about: 'Pong. There is not much more to say about Pong.',
  },

  // Block visualizations (also opened programmatically from Explorer)
  {
    id: 'block-map', title: 'Block Map', icon: '🗺️',
    defaultSize: { width: 920, height: 880 }, minSize: { width: 580, height: 520 },
    blurb: 'One block, drawn as tiles',
    about: 'Every transaction in a single block laid out visually, sized and coloured by type. Add ?height= to open a specific block.',
  },
  {
    id: 'chain-pulse', title: 'Chain Pulse', icon: '✨',
    defaultSize: { width: 920, height: 920 }, minSize: { width: 580, height: 580 },
    blurb: 'A block rendered as motion',
    about: 'An ambient visualisation of block contents as pulsing particles. Add ?height= to target a block.',
  },
  {
    id: 'tx-graph', title: 'TX Graph', icon: '🕸',
    defaultSize: { width: 1060, height: 800 }, minSize: { width: 740, height: 540 }, category: 'tools',
    blurb: 'Trace a transaction to its sources',
    about: 'Draws a transaction alongside the transactions that funded it. Add ?txid= to open one directly.',
  },
  {
    id: 'mempool', title: 'Mempool', icon: '⏳',
    defaultSize: { width: 980, height: 820 }, minSize: { width: 640, height: 520 }, category: 'tools',
    blurb: 'Unconfirmed transactions right now',
    about: 'Live view of transactions waiting to be mined, colour-coded by which pools they touch.',
  },

  // Desktop files (no category)
  {
    id: 'readme', title: 'README.txt', icon: '📄',
    defaultSize: { width: 780, height: 780 }, minSize: { width: 480, height: 420 },
    blurb: 'Start here if you are new',
    about: 'The orientation document for ZEC-OS - what it does and how to get around.',
  },


  // Registry

  // Folder windows - desktop-only navigation surfaces.
  { id: 'stats-folder', title: 'Stats', icon: '📊', defaultSize: { width: 520, height: 580 }, minSize: { width: 360, height: 380 }, standalone: false },
  { id: 'charts-folder', title: 'Charts', icon: '📈', defaultSize: { width: 460, height: 500 }, minSize: { width: 320, height: 320 }, standalone: false },
  { id: 'tools-folder', title: 'Tools', icon: '🔧', defaultSize: { width: 520, height: 560 }, minSize: { width: 360, height: 360 }, standalone: false },
  { id: 'games-folder', title: 'Games', icon: '🎮', defaultSize: { width: 400, height: 420 }, minSize: { width: 280, height: 280 }, standalone: false },
  { id: 'privacy-folder', title: 'Privacy', icon: '🔒', defaultSize: { width: 400, height: 420 }, minSize: { width: 280, height: 280 }, standalone: false },
  { id: 'education-folder', title: 'Education', icon: '📖', defaultSize: { width: 400, height: 420 }, minSize: { width: 280, height: 280 }, standalone: false },
  { id: 'media-folder', title: 'Media', icon: '🎵', defaultSize: { width: 400, height: 420 }, minSize: { width: 280, height: 280 }, standalone: false },
  { id: 'system-folder', title: 'System', icon: '💾', defaultSize: { width: 520, height: 560 }, minSize: { width: 360, height: 360 }, standalone: false },
  { id: 'widgets-folder', title: 'Widgets', icon: '🧩', defaultSize: { width: 440, height: 460 }, minSize: { width: 300, height: 300 }, standalone: false },

  // Widgets
  {
    id: 'network-data', title: 'Network Data', icon: '📡',
    defaultSize: { width: 680, height: 680 }, minSize: { width: 520, height: 480 }, category: 'widgets',
    blurb: 'Key network stats together',
    about: 'A consolidated readout of height, supply, pool split and shielded percentage in one panel.',
  },
  {
    id: 'charts-dashboard', title: 'Charts Dashboard', icon: '📊',
    defaultSize: { width: 1080, height: 900 }, minSize: { width: 760, height: 580 }, category: 'widgets',
    blurb: 'Four charts on one screen',
    about: 'Price, shielded, pools and supply charts tiled together for an at-a-glance view.',
  },
  {
    id: 'halving-widget', title: 'Halving Countdown', icon: '⏳',
    defaultSize: { width: 560, height: 700 }, minSize: { width: 400, height: 480 }, category: 'widgets',
    blurb: 'Time until the next halving',
    about: 'Blocks and estimated time remaining until the block reward next halves.',
  },
  // Registry placeholder only - rendered separately as the always-on strip.
  { id: 'block-ticker', title: 'Block Ticker', icon: '📺', defaultSize: { width: 0, height: 0 }, minSize: { width: 0, height: 0 }, category: 'widgets', standalone: false },
];

/** Listed for this viewer? A sudobud sees the sysop's apps, except user management. */
/** Admin apps a sudobud never sees: user management, the sysop's own usage metrics, the system debugger and moderation. */
const SYSOP_ONLY = new Set(['users', 'metrics', 'system-debugger', 'moderation']);
export function adminAppVisible(app: Pick<AppMeta, 'id' | 'adminOnly'>, admin: boolean, sudobud: boolean): boolean {
  return !app.adminOnly || admin || (sudobud && !SYSOP_ONLY.has(app.id));
}

/**
 * Resolve how an app should render standalone, or null if it has no route.
 * Admin-only apps are never exposed at a public URL.
 */
export function getStandaloneMode(app: AppMeta): Exclude<StandaloneMode, false> | null {
  if (app.standalone === false) return null;
  if (app.adminOnly) return null;
  return app.standalone ?? 'simple';
}

/** Look up app metadata by id, but only if it is exposed standalone. */
export function getStandaloneMeta(id: string): AppMeta | null {
  const app = APP_META.find((a) => a.id === id);
  if (!app) return null;
  return getStandaloneMode(app) ? app : null;
}

/** Every app that has a standalone route (used for the index + static params). */
export function listStandaloneApps(): AppMeta[] {
  return APP_META.filter((a) => getStandaloneMode(a) !== null);
}
