import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/** Zkyline: GET /api/zkyline/board (public), POST /api/zkyline/start and /finish (verified). Relayed as-is. */
async function relay(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (!['board', 'start', 'finish'].includes(path[0] ?? '')) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const url = `${BACKEND}/api/zkyline/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const h: Record<string, string> = { ...proxyHeaders(req) };
  const auth = req.headers.get('authorization');
  if (auth) h.Authorization = auth;
  const hasBody = req.method === 'POST';
  if (hasBody) h['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, { method: req.method, headers: h, cache: 'no-store', body: hasBody ? (await req.text()) || '{}' : undefined });
    const body = await res.json().catch(() => ({ error: `Backend answered ${res.status}` }));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}

export { relay as GET, relay as POST };
