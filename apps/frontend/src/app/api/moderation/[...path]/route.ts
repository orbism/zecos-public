import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/** Moderation (sysop). Relayed as-is with the caller's token; the backend checks it is the sysop. */
async function relay(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const h: Record<string, string> = { ...proxyHeaders(req) };
  const auth = req.headers.get('authorization');
  if (auth) h.Authorization = auth;
  const post = req.method === 'POST';
  if (post) h['Content-Type'] = 'application/json';
  try {
    const res = await fetch(`${BACKEND}/api/moderation/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, {
      method: req.method, headers: h, cache: 'no-store', body: post ? (await req.text()) || '{}' : undefined,
    });
    const body = await res.json().catch(() => ({ error: `Backend answered ${res.status}` }));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
export { relay as GET, relay as POST };
