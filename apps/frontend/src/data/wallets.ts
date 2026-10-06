/**
 * Zcash wallets and what they support, for the Rescue Kit and Zcash Status.
 * Generated from the ZecHub wallet list (GitHub, read 2026-10-04), then
 * corrected from the sysop's services table (official sources, 2026-10-02),
 * which wins where the two disagree. `ironwood: 'unknown'` means the list does not say.
 */

export type WalletKind = 'shielded' | 'transparent-only' | 'hardware' | 'sunset';
export type Readiness = 'ready' | 'in-progress' | 'not-ready' | 'unknown';

export interface WalletInfo {
  name: string;
  url: string;
  kind: WalletKind;
  devices: string[];
  pools: string[];
  support: string[];
  features: string[];
  ironwood: Readiness;
  note?: string | null;
}

export const WALLETS_SOURCE = { label: 'ZecHub wallets list, corrected from official sources', url: 'https://github.com/zechub/zechub/blob/main/site/Using_Zcash/Wallets.md', checked: '2026-10-02' };

export const WALLETS: WalletInfo[] = [
 {
  "name": "Zodl (was Zashi)",
  "url": "https://zodl.com",
  "kind": "shielded",
  "devices": [
   "Mobile"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Hardware"
  ],
  "features": [
   "Address Book",
   "CrossPay",
   "NEAR Intents",
   "Flexa Payments",
   "MultiSignature",
   "Payment Request",
   "Shielded Memo",
   "Spend before Sync",
   "TEX Address",
   "Tor Support"
  ],
  "ironwood": "ready",
  "note": "Shielded-first, with a guided Orchard to Ironwood migration. Restores 24-word seeds; restoring a 12-word seed is not supported (open issue, Mar 2026). Cake, Zingo and Trust restore 12-word seeds."
 },
 {
  "name": "YWallet",
  "url": "https://ywallet.app/installation/",
  "kind": "sunset",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Hardware"
  ],
  "features": [
   "Address Book",
   "Cold Storage",
   "Diversified Address",
   "Payment Request",
   "Pool Transfer",
   "Shielded Memo",
   "TEX Address",
   "Voting",
   "WarpSync"
  ],
  "ironwood": "not-ready",
  "note": "Stopped supporting Zcash after Ironwood. Its author points Zcash users to Zkool."
 },
 {
  "name": "Dizzy",
  "url": "https://youtu.be/IVkuo1CGPBU",
  "kind": "shielded",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address"
  ],
  "features": [
   "Discord Bot"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "Zingo!",
  "url": "https://www.zingolabs.org/",
  "kind": "shielded",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address"
  ],
  "features": [
   "Address Book",
   "Financial Insights",
   "Payment Request",
   "PepperSync",
   "Shielded Memo",
   "Testnet Support"
  ],
  "ironwood": "ready",
  "note": "Shielded by default; the desktop app supports Ironwood and Sapling."
 },
 {
  "name": "Edge",
  "url": "https://edge.app",
  "kind": "shielded",
  "devices": [
   "Mobile"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Unified Address"
  ],
  "features": [
   "Automatic Shielding",
   "DEX Swaps",
   "Multi Coin",
   "Shielded Memo",
   "Spend before Sync"
  ],
  "ironwood": "ready",
  "note": "Shielded Zcash; Orchard to Ironwood migration shipped in v4.50.2."
 },
 {
  "name": "Unstoppable",
  "url": "https://unstoppable.money",
  "kind": "shielded",
  "devices": [
   "Mobile"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Unified Address"
  ],
  "features": [
   "DEX Swaps",
   "Multi Coin",
   "Spend before Sync"
  ],
  "ironwood": "ready",
  "note": "Ironwood support, and shielded ZEC swaps."
 },
 {
  "name": "eZcash",
  "url": "https://play.google.com/store/apps/details?id=com.Nerdbank.eZcash.App",
  "kind": "shielded",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address"
  ],
  "features": [
   "Address Book",
   "Address Check",
   "Automatic Shielding",
   "Diversified Address",
   "Payment Request",
   "Shielded Memo",
   "TEX Address",
   "Testnet Support"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "Zkool",
  "url": "https://github.com/hhanh00/zkool2/",
  "kind": "shielded",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Hardware"
  ],
  "features": [
   "Address Rotation",
   "Broad Key Support",
   "Encrypted Exports",
   "FROST Multisig",
   "Multi-Account Sync",
   "Shielded Memo",
   "Testnet Support"
  ],
  "ironwood": "ready",
  "note": "The current Zcash wallet from the YWallet author. Ironwood, plus Ledger signing."
 },
 {
  "name": "Cake",
  "url": "https://cakewallet.com/install/",
  "kind": "shielded",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address"
  ],
  "features": [
   "Address Book",
   "Address Rotation",
   "Automatic Shielding",
   "DEX Swaps",
   "Multi Coin",
   "Shielded Memo",
   "Tor Support"
  ],
  "ironwood": "ready",
  "note": "Shielded Zcash; Ironwood support shipped in v6.4.0."
 },
 {
  "name": "Zenith",
  "url": "https://code.vergara.tech/Vergara_Tech/zenith",
  "kind": "shielded",
  "devices": [
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Full Node"
  ],
  "features": [
   "Address Book",
   "Graphical Interface",
   "Shielded Memo",
   "Testnet Support"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "zingo-cli",
  "url": "https://github.com/zingolabs/zingolib",
  "kind": "shielded",
  "devices": [
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Full Node"
  ],
  "features": [
   "Command Line Interface",
   "PepperSync",
   "Shielded Memo",
   "Testnet Support"
  ],
  "ironwood": "in-progress",
  "note": null
 },
 {
  "name": "Zallet",
  "url": "https://github.com/zcash/wallet",
  "kind": "shielded",
  "devices": [
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Full Node"
  ],
  "features": [
   "Alpha Release",
   "JSON-RPC Interface",
   "Shielded Memo",
   "Testnet Support"
  ],
  "ironwood": "ready",
  "note": "Beta. The zcashd wallet successor, with Ironwood wallet and RPC support."
 },
 {
  "name": "zcashd",
  "url": "https://github.com/zcash/zcash",
  "kind": "sunset",
  "devices": [
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Full Node"
  ],
  "features": [
   "Command Line Interface",
   "Diversified Address",
   "Shielded Memo",
   "Testnet Support"
  ],
  "ironwood": "not-ready",
  "note": "End of life since 2026-07-18; no Ironwood support. Move to Zebra (or Zakura) plus Zallet."
 },
 {
  "name": "Brave",
  "url": "https://brave.com/web3-privacy/",
  "kind": "shielded",
  "devices": [
   "Web"
  ],
  "pools": [
   "Transparent",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Unified Address"
  ],
  "features": [
   "Shielded Memo",
   "Spend before Sync",
   "Testnet Support"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "MetaMask Snap",
  "url": "https://snaps.metamask.io/snap/npm/chainsafe/webzjs-zcash-snap/",
  "kind": "shielded",
  "devices": [
   "Web"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Unified Address"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "Zucchini",
  "url": "https://zucchinifi.xyz/",
  "kind": "shielded",
  "devices": [
   "Web"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Unified Address"
  ],
  "features": [
   "DEX Swaps"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "SSP Wallet",
  "url": "https://sspwallet.io",
  "kind": "transparent-only",
  "devices": [
   "Mobile",
   "Web"
  ],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Seed Phrase"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "Trust Wallet",
  "url": "https://trustwallet.com/download",
  "kind": "transparent-only",
  "devices": [
   "Mobile",
   "Web"
  ],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Seed Phrase"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": "No shielded support claimed on its Zcash page."
 },
 {
  "name": "Guarda",
  "url": "https://guarda.com/coins/zcash-wallet/",
  "kind": "transparent-only",
  "devices": [
   "Mobile",
   "Desktop",
   "Web"
  ],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Seed Phrase"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": "Claims ZEC support; no shielded claim."
 },
 {
  "name": "Exodus",
  "url": "https://www.exodus.com/zcash-wallet-zec",
  "kind": "transparent-only",
  "devices": [
   "Mobile",
   "Desktop",
   "Web"
  ],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Seed Phrase"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": "Does not support shielded addresses."
 },
 {
  "name": "Atomic Wallet",
  "url": "https://atomicwallet.io",
  "kind": "transparent-only",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Seed Phrase"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": "Its ZEC wallet uses transparent addresses."
 },
 {
  "name": "Coinomi",
  "url": "https://www.coinomi.com/en/downloads",
  "kind": "transparent-only",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Seed Phrase"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "Keystone",
  "url": "https://shop.keyst.one",
  "kind": "hardware",
  "devices": [],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Hardware",
   "Unified Address"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "ready",
  "note": "Firmware 3.0.2 or later supports Ironwood and batch signing; used with Zodl and Vizor. Enter a birthday height when connecting."
 },
 {
  "name": "Ledger",
  "url": "https://www.ledger.com/coin/wallet/zcash",
  "kind": "hardware",
  "devices": [
   "Desktop",
   "Mobile"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Hardware"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "ready",
  "note": "Native shielded ZEC in Ledger Wallet Desktop since 2026-09-23, no companion wallet needed. Reported not to cover the Nano X."
 },
 {
  "name": "Safepal",
  "url": "https://safepal.com",
  "kind": "transparent-only",
  "devices": [
   "Mobile",
   "Web"
  ],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Seed Phrase",
   "Hardware"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "Trezor",
  "url": "https://trezor.io/learn/supported-assets/other-cryptocurrencies/zcash-what-it-is-and-how-it-works-with-trezor",
  "kind": "hardware",
  "devices": [],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Hardware"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": "Transparent t-addresses only; shielded transactions are not supported."
 },
 {
  "name": "OneKey Pro 2",
  "url": "https://onekey.so",
  "kind": "hardware",
  "devices": [],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Hardware"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "in-progress",
  "note": "Shielded ZEC announced: a Sep 1, 2026 update targeted launch before Oct 15. No production release confirmed as of Oct 2."
 },
 {
  "name": "Vultisig",
  "url": "https://vultisig.com",
  "kind": "transparent-only",
  "devices": [
   "Web",
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent"
  ],
  "support": [],
  "features": [
   "Multi Coin",
   "Web App"
  ],
  "ironwood": "unknown",
  "note": "Lists Zcash; shielded support not documented."
 },
 {
  "name": "Vizor",
  "url": "https://vizor.cash/",
  "kind": "shielded",
  "devices": [
   "Desktop",
   "Mobile"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Unified Address",
   "Hardware"
  ],
  "features": [
   "Automatic Shielding",
   "Shielded Memo",
   "Testnet Support",
   "FROST Multisig"
  ],
  "ironwood": "ready",
  "note": "Guided Orchard to Ironwood migration; Keystone signing."
 },
 {
  "name": "Noir wallet",
  "url": "https://www.zknoir.com/",
  "kind": "shielded",
  "devices": [
   "Web",
   "Desktop"
  ],
  "pools": [
   "Shielded",
   "Transparent"
  ],
  "support": [],
  "features": [
   "Browser Extension",
   "Shielded Transactions",
   "Cross-chain Swaps",
   "Lending & Borrowing",
   "DApp Connections",
   "Rhea"
  ],
  "ironwood": "unknown",
  "note": "Transparent and shielded addresses, shielding and private sends; its docs do not name the current pool."
 },
 {
  "name": "Mane Wallet (LeoDex)",
  "url": "https://leodex.io/",
  "kind": "shielded",
  "devices": [
   "Web",
   "Desktop"
  ],
  "pools": [
   "Sapling",
   "Transparent"
  ],
  "support": [
   "Seed Phrase",
   "External Wallet",
   "Receive Address",
   "QR Code",
   "Hardware"
  ],
  "features": [
   "Multi Coin",
   "NEAR Intents",
   "Maya DEX",
   "No KYC",
   "Non-Custodial",
   "Web App",
   "Desktop App",
   "Shielded ZEC",
   "AnyPay"
  ],
  "ironwood": "ready",
  "note": "Shielded Zcash, explicitly Ironwood compatible."
 },
 {
  "name": "Zapp",
  "url": "https://www.justzappit.xyz/app",
  "kind": "shielded",
  "devices": [
   "Mobile"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Unified Address"
  ],
  "features": [
   "End-to-end encrypted Messenger",
   "NEAR Intents",
   "P2P.me Offramp",
   "Beta"
  ],
  "ironwood": "ready",
  "note": null
 },
 {
  "name": "zecd",
  "url": "https://zecd.org/quickstart.html",
  "kind": "shielded",
  "devices": [
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood",
   "Sprout"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Private Key",
   "Spending Key",
   "Wallet Backup / Key Export",
   "Full Node Wallet"
  ],
  "features": [
   "Encrypted Memo",
   "Wallet Backup (wallet data)",
   "RPC Interface",
   "Shielded Memo",
   "Private Key Management"
  ],
  "ironwood": "unknown",
  "note": "Shielded-first wallet server. Ironwood support not explicitly stated."
 },
 {
  "name": "zcash-walletd",
  "url": "https://github.com/hhanh00/zcash-walletd",
  "kind": "shielded",
  "devices": [
   "Desktop"
  ],
  "pools": [
   "Sapling",
   "Orchard",
   "Ironwood"
  ],
  "support": [
   "Unified Address"
  ],
  "features": [
   "REST API",
   "Shielded only"
  ],
  "ironwood": "ready",
  "note": "Shielded-only REST wallet server. Sapling, Orchard, Ironwood and unified addresses."
 },
 {
  "name": "Zend:Zcash Wallet",
  "url": "https://justzend.com/",
  "kind": "shielded",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Passkey",
   "Unified Address",
   "Private Key",
   "Self-Custody Wallet"
  ],
  "features": [
   "Self-Custody",
   "Private Key Stored Locally",
   "No KYC Required",
   "No Zend Server Dependency for Wallet Activity",
   "Encrypted Shielded Transaction",
   "Seed Recovery",
   "Shielded Memo",
   "Passkey Authentication"
  ],
  "ironwood": "unknown",
  "note": null
 },
 {
  "name": "Nozy Wallet",
  "url": "https://github.com/LEONINE-DAO/Nozy-wallet",
  "kind": "shielded",
  "devices": [
   "Desktop",
   "Browser"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Spending Key",
   "HD Wallet",
   "Private Key Management"
  ],
  "features": [
   "Address Book",
   "Tor Support",
   "I2P Support",
   "Zebra/zebrad Integration",
   "Transaction History",
   "Transaction Export",
   "Local Witness Derivation",
   "Dynamic Fee (ZIP-317)",
   "NU6.2 Compatibility",
   "NU6.3 Migration Support",
   "Shielded Memo"
  ],
  "ironwood": "ready",
  "note": null
 },
 {
  "name": "Zipher",
  "url": "https://github.com/atmospherelabs-dev/zipher-app",
  "kind": "shielded",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Viewing Key",
   "Unified Address",
   "Multi Account Wallet",
   "Self-Custody Wallet",
   "Private Key Management",
   "Agent Wallet Support"
  ],
  "features": [
   "NEAR Intents",
   "Payment Requests",
   "Shielded Memo",
   "Shielded Transaction Default",
   "Testnet",
   "Cross-chain Swap",
   "CipherPay",
   "Viewing Key",
   "AI Agent",
   "MCP Server",
   "CLI Wallet",
   "FROST",
   "Beta"
  ],
  "ironwood": "in-progress",
  "note": null
 },
 {
  "name": "Argos",
  "url": "https://argos.sovright.com/",
  "kind": "shielded",
  "devices": [
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood",
   "Sprout"
  ],
  "support": [
   "Seed Phrase",
   "Spending Key",
   "Private Key",
   "Wallet Backup / Key Export"
  ],
  "features": [
   "Wallet Recovery",
   "Command Line Interface",
   "Shielded Memo",
   "Testnet Support"
  ],
  "ironwood": "ready",
  "note": "Recovery tool for old wallets and keys, including Sprout."
 },
 {
  "name": "Gem Wallet",
  "url": "https://gemwallet.com/zcash-wallet/",
  "kind": "transparent-only",
  "devices": [
   "Mobile"
  ],
  "pools": [
   "Transparent"
  ],
  "support": [
   "Seed Phrase"
  ],
  "features": [
   "Multi Coin"
  ],
  "ironwood": "unknown",
  "note": "Transparent addresses only."
 },
 {
  "name": "Freedom Wallet",
  "url": "https://www.freedomwallet.com/",
  "kind": "shielded",
  "devices": [
   "Mobile",
   "Desktop"
  ],
  "pools": [
   "Transparent",
   "Sapling",
   "Ironwood"
  ],
  "support": [
   "Seed Phrase",
   "Private Key",
   "Self-Custody Wallet",
   "Unified Address"
  ],
  "features": [
   "Multi-Chain Privacy Support",
   "Encrypted Shielded Transaction",
   "Seed Recovery",
   "In-App Swaps",
   "Light Wallet Sync"
  ],
  "ironwood": "in-progress",
  "note": null
 },
 {
  "name": "Zecwallet Lite",
  "url": "https://github.com/adityapk00/zecwallet-lite",
  "kind": "sunset",
  "devices": [
   "Desktop",
   "Mobile"
  ],
  "pools": [],
  "support": [],
  "features": [],
  "ironwood": "not-ready",
  "note": "Discontinued. Restore its seed in a current wallet; the forum stuck-funds thread has wallet-specific steps."
 },
 {
  "name": "Nighthawk",
  "url": "https://github.com/nighthawk-apps",
  "kind": "sunset",
  "devices": [
   "Mobile"
  ],
  "pools": [],
  "support": [],
  "features": [],
  "ironwood": "not-ready",
  "note": "Discontinued; the team moved to DarkFi and the Zcash app was archived. Restore its seed in a current wallet."
 }
];
