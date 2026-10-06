import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/**
 * Relay one request to the app backend, passing the caller's bearer token
 * (the backend does the authorising) and the body for writes. Any failure
 * comes back as JSON, never as an HTML error page.
 */
export async function fwd(req: NextRequest, path: string): Promise<NextResponse> {
  const method = req.method.toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(proxyHeaders(req) as Record<string, string>) };
  const auth = req.headers.get('authorization');
  if (auth) headers.Authorization = auth;
  const body = method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(await req.json().catch(() => ({})));
  try {
    const res = await fetch(`${BACKEND}${path}`, { method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    const json = await res.json().catch(() => ({ error: `Backend answered ${res.status}` }));
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
