import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/**
 * Which beta apps are live for everyone: `{ enabled: { "<appId>": true } }`.
 * Public. If the backend is down or does not know the route yet, everything
 * is off, so every beta app shows its preview. The safe default.
 */
export async function GET(req: NextRequest) {
  try {
    const res = await fetch(`${BACKEND}/api/beta`, { headers: proxyHeaders(req), cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ enabled: {}, offline: true }, { status: 200 });
    return NextResponse.json(await res.json(), { status: 200 });
  } catch { return NextResponse.json({ enabled: {}, offline: true }, { status: 200 }); }
}
