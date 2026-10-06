import { NextRequest } from 'next/server';
import { forwardLink } from '../../link-testnet/_forward';

/** Watch an add-address challenge: pending, code_sent, linked or expired. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ nonce: string }> }) {
  const { nonce } = await params;
  return forwardLink(req, `/link-address/${encodeURIComponent(nonce)}`);
}

/** Wallet-backed: outlive the proxy's 90s abort so ITS error wins, not the platform's. */
export const maxDuration = 100;
