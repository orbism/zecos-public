import { NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

// Current ZEC/USD price now comes from our own self-hosted oracle in the Fastify
// backend (median of live exchange tickers, cached + stale-served), rather than a
// single external aggregator. See apps/backend/src/price/oracle.ts.
const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

export async function GET(req: Request) {
  try {
    const res = await fetch(`${BACKEND}/api/price`, {
      // Secret only: the price is the same for everyone, and a per-browser IP
      // here would split this 30s cache into one entry per visitor.
      headers: proxyHeaders(),
      // Browser/CDN caches briefly; the oracle also caches server-side.
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      throw new Error(`Price backend responded with ${res.status}`);
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch price:', error);
    return NextResponse.json(
      { error: 'Failed to fetch price' },
      { status: 502 }
    );
  }
}
