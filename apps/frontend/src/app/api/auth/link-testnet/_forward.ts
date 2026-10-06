import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/**
 * Forward a testnet-link call.
 *
 * Unlike the other auth proxies these carry the bearer token: linking attaches
 * an address to the account you are signed into, so the backend has to know
 * which account that is. Every one of these can touch the wallet (watching for
 * the funding memo, sending the code), so the same 90s abort as the rings proxy
 * applies - an answer the caller can read before Cloudflare's 100s 524.
 */
export async function forwardLink(req: NextRequest, path: string, init?: { method: string; body?: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...proxyHeaders(req) };
  const auth = req.headers.get('authorization');
  if (auth) headers.Authorization = auth;
  try {
    const res = await fetch(`${BACKEND}/api/auth${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
      cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let json: unknown;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text.slice(0, 300) || `upstream returned ${res.status}` }; }
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return NextResponse.json(
      { error: timedOut ? 'Auth backend timed out' : 'Auth backend unreachable' },
      { status: timedOut ? 504 : 503 },
    );
  }
}
