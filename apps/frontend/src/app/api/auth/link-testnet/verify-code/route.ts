import { NextRequest } from 'next/server';
import { forwardLink } from '../_forward';

/** Finish a link with the code that arrived as a memo at the testnet address. */
export async function POST(req: NextRequest) {
  return forwardLink(req, '/link-testnet/verify-code', { method: 'POST', body: JSON.stringify(await req.json().catch(() => ({}))) });
}

/** Wallet-backed: outlive the proxy's 90s abort so ITS error wins, not the platform's. */
export const maxDuration = 100;
