import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ nonce: string }> },
) {
  const { nonce } = await params;
  try {
    const res = await fetch(`${BACKEND}/api/auth/verify/${nonce}`, { headers: proxyHeaders(req) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ verified: false, error: 'Auth backend unreachable' }, { status: 503 });
  }
}
