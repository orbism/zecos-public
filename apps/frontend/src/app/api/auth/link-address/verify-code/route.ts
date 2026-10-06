import { NextRequest } from 'next/server';
import { forwardLink } from '../../link-testnet/_forward';

/** Finish with the code that arrived as a memo at the address being added. */
export async function POST(req: NextRequest) {
  return forwardLink(req, '/link-address/verify-code', { method: 'POST', body: JSON.stringify(await req.json().catch(() => ({}))) });
}

/** Wallet-backed: outlive the proxy's 90s abort so ITS error wins, not the platform's. */
export const maxDuration = 100;
