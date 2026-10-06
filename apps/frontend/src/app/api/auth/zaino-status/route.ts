import { NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

export async function GET(req: Request) {
  try {
    const res = await fetch(`${BACKEND}/api/auth/zaino-status`, { headers: proxyHeaders(req) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Auth backend unreachable', connected: false }, { status: 503 });
  }
}
