// NEAR Intents 1Click API config (server-side only).
// Phase 1 of the ZEC-OS Swap app: ZEC -> USDC/ETH via a non-custodial
// intent router. The user sends ZEC to a deposit address themselves; the
// app never holds keys or funds. The JWT stays server-side (never exposed
// to the client) - authenticated requests are fee-free.
//
// Env var is `CLICK1_API_KEY` (renamed from `1CLICK_API_KEY` - Vercel disallows
// env names starting with a digit).

export const ONECLICK_BASE = process.env.ONECLICK_BASE_URL || 'https://1click.chaindefuser.com/v0';

export function getSwapKey(): string {
  return process.env.CLICK1_API_KEY || '';
}

// Headers for 1Click requests. Authorization omitted if no key is set -
// the API still works unauthenticated (with a 0.2% platform fee), so the
// app degrades gracefully rather than hard-failing.
export function swapHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const key = getSwapKey();
  if (key) h['Authorization'] = `Bearer ${key}`;
  return h;
}
