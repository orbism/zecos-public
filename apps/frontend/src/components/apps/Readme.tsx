'use client';

import { ColourText } from '@/components/Colour';

export function Readme() {
  return (
    <div className="h-full overflow-auto p-4 bg-[var(--bg-window)]">
      <pre
        className="text-[var(--text-primary)] whitespace-pre-wrap"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-doc)', lineHeight: 1.6 }}
      >
<ColourText>{`=====================================
  ZEC-OS  v${process.env.NEXT_PUBLIC_VERSION ?? '1.1.2'}
  by orb, 2026
=====================================

  UX over ideology.
  Explore. Analyze. Learn. Play.

A desktop OS interface for the Zcash
blockchain - built around one belief:
great UX is the most powerful privacy
tool. When using Zcash feels good,
more people actually use it. That
network effect matters for everyone.

This is not about ideology. It is
about making the Zcash network
genuinely accessible: clear data,
intuitive tools, and an interface
that feels fun and functional without
requiring deep technical knowledge.

Whether you are a developer checking
mempool depth, a merchant tracking
payments, or someone new to ZEC -
ZEC-OS is built for you.

-------------------------------------
GETTING STARTED
-------------------------------------

Double-click any desktop folder to
browse its apps.

Use the ZEC-OS menu (top-left) for
quick access to every tool.

Drag and resize windows freely.
Multiple windows can be open at once.

-------------------------------------
STATS
-------------------------------------

Live snapshots of chain state:
price, block height, difficulty,
pool balances, shielding percentage,
total supply, and transaction count.

-------------------------------------
CHARTS
-------------------------------------

Historical charts over selectable
time ranges:
  - ZEC/USD price
  - Shielded pool growth
  - Pool distribution over time
    (Sprout / Sapling / Orchard / Ironwood)
  - Supply vs USD value

-------------------------------------
TOOLS
-------------------------------------

Swap  💱
  Turn ZEC into USDC or ETH without
  giving up custody. You send ZEC
  from your own wallet to a one-time
  deposit address; a solver (NEAR
  Intents) delivers the result to a
  recipient you choose. We never hold
  your keys or your funds.

  Two kinds of destination:
    0x  (public)  - a normal Ethereum
        address. Fast, transparent.
    0zk (shielded) - lands privately
        inside Railgun's shielded pool
        at your 0zk address. Guests
        can use this too - paste a ZEC
        refund address instead of
        signing in.

  How to swap:
    1. Pick USDC or ETH and an amount.
    2. Paste your recipient (0x or 0zk)
       and a ZEC refund address.
    3. You'll see the estimate, the
       0.5% service fee, and (for 0zk)
       the live shield cost up front -
       tiny swaps that can't cover gas
       are blocked before you commit.
    4. Send the exact ZEC shown to the
       deposit address (scan the QR).
    5. Watch the progress panel - it
       tells you in plain words what's
       done and what's next. You can
       close the window; you'll be
       notified when it lands.

  If a shielded landing can't complete
  after automatic retries, your funds
  are swapped back to ZEC and returned
  to your refund address - privately,
  never to a public address. Nothing
  is ever held indefinitely.

  Cross-chain swaps take a few minutes.
  The ZEC leg opens in our Explorer;
  the Ethereum leg opens on Etherscan.

Explorer
  Search blocks, transactions, and
  addresses. Jump to historical
  events. View raw JSON. TX Graph
  and Mempool linked inline.

Mempool
  Live unconfirmed transaction feed.
  Heatmap and table views, colored
  by fee rate. Auto-refreshes every
  12 seconds. Click any tx to open
  in Explorer.

Mining
  Miner leaderboard, pool share
  breakdown, animated radial
  Universe visualization, timeline
  chart, and per-address search.

TX Graph
  SVG visualization of a transaction
  and its input/output connections.
  Open from any tx in Explorer.

Block Comparison
  Load any two blocks side-by-side.
  Diffed fields highlighted in gold.

Address Decoder
  Decode Unified Addresses into their
  component receiver types.

Watchlist
  Save and label ZEC addresses.
  Click any entry to open in Explorer.

Calculator
  Convert ZAT ↔ ZEC ↔ USD.

Terminal
  Command-line interface for chain
  queries and system info.

Themes
  Switch visual themes (retro green,
  dark amber, high-contrast, and
  more).

Settings
  App preferences and configuration.

-------------------------------------
PRIVACY
-------------------------------------

Privacy Weather
  At-a-glance privacy health score
  for the address you enter.

Privacy Coach
  Guided tips for improving on-chain
  privacy when using Zcash.

Privacy Flow Chart
  Visual diagram of how shielded
  transactions flow through pools.

-------------------------------------
WIDGETS
-------------------------------------

Block Ticker
  Persistent bottom strip showing
  the last 12 blocks in real time.
  Click any block to open in
  Explorer. Re-open from Widgets
  folder if closed.

Halving Widget
  Countdown to next ZEC halving
  with subsidy and supply stats.

Network Data
  Live network vitals in a compact
  always-on-screen panel.

Charts Dashboard
  Multi-chart overview panel.

-------------------------------------
GAMES
-------------------------------------

Dark Forest (BBS RPG)
  Text adventure set in the Zcash
  universe.

Pong / Shmup
  Retro arcade games.

-------------------------------------

Built with Next.js + TypeScript
Powered by Zcash / Zebra
LAN-only - no external auth

-------------------------------------
CREDITS
-------------------------------------

Created by Orb
  orbatron.org
  x.com/artoforb

=====================================`}</ColourText>
      </pre>
    </div>
  );
}

export default Readme;
