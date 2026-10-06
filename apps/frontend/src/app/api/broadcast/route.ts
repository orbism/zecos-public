import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const res = await fetch(`${BACKEND}/api/broadcast${qs ? `?${qs}` : ''}`, { headers: proxyHeaders(req) });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch { return NextResponse.json({ broadcast: null }, { status: 200 }); }
}
