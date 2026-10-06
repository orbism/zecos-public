import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('Authorization');
    const gid = req.nextUrl.searchParams.get('guestId') || '';
    const res = await fetch(`${BACKEND}/api/guest/admin/thread?guestId=${encodeURIComponent(gid)}`, { headers: { ...(token ? { Authorization: token } : {}), ...proxyHeaders(req) } });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch { return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 }); }
}
