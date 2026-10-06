import { NextRequest } from 'next/server';
import { forwardLink } from '../link-testnet/_forward';

/**
 * Start proving ANOTHER address for the signed-in account, on whatever network
 * the app is on. Same proof as the testnet linker beside it, one path apart.
 */
export async function POST(req: NextRequest) {
  return forwardLink(req, '/link-address', { method: 'POST', body: JSON.stringify(await req.json().catch(() => ({}))) });
}

/** Wallet-backed: outlive the proxy's 90s abort so ITS error wins, not the platform's. */
export const maxDuration = 100;
