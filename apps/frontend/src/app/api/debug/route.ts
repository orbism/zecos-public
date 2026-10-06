import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/** The System Debugger. Relayed as-is; the backend checks it is the sysop. */
export async function GET(req: NextRequest) {
  const h: Record<string, string> = { ...proxyHeaders(req) };
  const auth = req.headers.get('authorization');
  if (auth) h.Authorization = auth;
  try {
    const res = await fetch(`${BACKEND}/api/debug`, { headers: h, cache: 'no-store' });
    const body = await res.json().catch(() => ({ error: `Backend answered ${res.status}` }));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
