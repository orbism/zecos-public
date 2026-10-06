import { NextRequest } from 'next/server';
import { forwardLink } from './_forward';

/** Start proving a testnet address for the signed-in account. */
export async function POST(req: NextRequest) {
  return forwardLink(req, '/link-testnet', { method: 'POST', body: JSON.stringify(await req.json().catch(() => ({}))) });
}

/** Wallet-backed: outlive the proxy's 90s abort so ITS error wins, not the platform's. */
export const maxDuration = 100;
