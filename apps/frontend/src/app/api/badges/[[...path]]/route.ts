import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/**
 * Badges: GET /api/badges (public, every badge's image and tooltip) and the
 * sysop's /api/badges/admin/*. Relayed as-is with the caller's bearer token;
 * the backend does the authorising.
 */
async function relay(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const url = `${BACKEND}/api/badges${path.length ? '/' + path.map(encodeURIComponent).join('/') : ''}${req.nextUrl.search}`;
  const h: Record<string, string> = { ...proxyHeaders(req) };
  const auth = req.headers.get('authorization');
  if (auth) h.Authorization = auth;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE';
  if (hasBody) h['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, {
      method: req.method, headers: h, cache: 'no-store',
      body: hasBody ? (await req.text()) || '{}' : undefined,
    });
    const body = await res.json().catch(() => ({ error: `Backend answered ${res.status}` }));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}

export { relay as GET, relay as POST, relay as PUT, relay as DELETE };
