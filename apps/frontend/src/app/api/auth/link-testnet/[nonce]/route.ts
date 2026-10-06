import { NextRequest } from 'next/server';
import { forwardLink } from '../_forward';

/** Watch a link challenge: pending, code_sent, linked or expired. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ nonce: string }> }) {
  const { nonce } = await params;
  return forwardLink(req, `/link-testnet/${encodeURIComponent(nonce)}`);
}

/** Wallet-backed: outlive the proxy's 90s abort so ITS error wins, not the platform's. */
export const maxDuration = 100;
