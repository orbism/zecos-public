/**
 * Spend Map: shared types, the category and payment-route lists, and a few
 * curated places that are always shown (with sources), alongside the
 * approved community suggestions from the backend.
 */

export type PlaceKind = 'online' | 'in-person' | 'both';
export type PayVia = 'direct' | 'flexa' | 'cake-pay' | 'cipherpay' | 'btcpay' | 'nowpayments' | 'other';

export interface RegionRule { country: string; works: boolean; why?: string }

export interface Place {
  id: string;
  name: string;
  url?: string | null;
  kind: PlaceKind;
  category: string;
  description?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  payVia: PayVia;
  shielded?: boolean | null;
  regions?: RegionRule[] | null;
  /** Curated by ZEC-OS (with a source) rather than suggested by a user. */
  curated?: { label: string; url: string };
  status?: 'pending' | 'approved' | 'rejected';
  sysopNote?: string | null;
  submitterName?: string | null;
}

export const CATEGORIES: [string, string][] = [
  ['vpn', 'VPN and privacy'], ['hosting', 'Hosting and servers'], ['gift-cards', 'Gift cards and top-ups'],
  ['shop', 'Shop'], ['food', 'Food and drink'], ['services', 'Services'], ['travel', 'Travel'],
  ['donations', 'Donations'], ['digital', 'Digital goods and software'], ['other', 'Other'],
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES) as Record<string, string>;

export const PAY_VIA: [PayVia, string][] = [
  ['direct', 'Direct to their address'], ['flexa', 'Flexa (in Zodl)'], ['cake-pay', 'Cake Pay'], ['cipherpay', 'CipherPay'],
  ['btcpay', 'BTCPay Server'], ['nowpayments', 'NOWPayments'], ['other', 'Other'],
];
export const PAY_LABEL = Object.fromEntries(PAY_VIA) as Record<PayVia, string>;

export const KIND_LABEL: Record<PlaceKind, string> = { online: 'Online', 'in-person': 'In person', both: 'Online and in person' };

/** Always shown. Each one has a source; edit here, bump the source date. */
export const CURATED: Place[] = [
  {
    id: 'curated-nymvpn', name: 'NymVPN', url: 'https://nym.com', kind: 'online', category: 'vpn', payVia: 'btcpay', shielded: true,
    description: 'Mixnet VPN. The first service to accept shielded ZEC through the BTCPay Zcash plugin (July 2025).',
    curated: { label: 'ZCG: Nym accepts Zcash (2025-07-08)', url: 'https://zcashcommunitygrants.org/news/2025/07/08/nym-accepts-zcash/' },
  },
  {
    id: 'curated-cakepay', name: 'Cake Pay', url: 'https://cakepay.com', kind: 'online', category: 'gift-cards', payVia: 'cake-pay', shielded: true,
    description: 'Gift cards and prepaid cards, bought with shielded ZEC from inside Cake Wallet. Which cards you can buy depends on your country.',
    curated: { label: 'Cake Wallet: Cake Pay takes shielded ZEC (Nov 2025)', url: 'https://x.com/cakewallet/status/1988338435879506011' },
  },
  {
    id: 'curated-flexa', name: 'Flexa merchants (via Zodl)', url: 'https://zodl.com', kind: 'both', category: 'shop', payVia: 'flexa', shielded: null,
    description: 'Pay at Flexa merchants straight from Zodl. Reported as 9,000+ merchants across the US and SEPA countries. Users report checkout can be slow.',
    regions: [{ country: 'United States of America', works: true }],
    curated: { label: 'ZecHub digest (Aug 2026)', url: 'https://github.com/zechub/zechub' },
  },
];

export const MORE_PLACES = { label: 'paywithz.cash: the ZecHub merchant directory', url: 'https://paywithz.cash' };
