import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/**
 * Whether new accounts can be created: `{ open, reopensAt }`. Public. Anything
 * the backend cannot answer reads as open - the backend still refuses a closed
 * signup itself, so this only decides whether the login screen says so up front.
 */
export async function GET(req: NextRequest) {
  try {
    const res = await fetch(`${BACKEND}/api/registration`, { headers: proxyHeaders(req), cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ open: true, reopensAt: null });
    return NextResponse.json(await res.json());
  } catch { return NextResponse.json({ open: true, reopensAt: null }); }
}
