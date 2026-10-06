import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/** Sysop: open or close registrations. Body `{ open, reopensAt? }`. The backend authorises. */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('Authorization');
    const res = await fetch(`${BACKEND}/api/registration/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}), ...proxyHeaders(req) },
      body: JSON.stringify(await req.json().catch(() => ({}))),
    });
    const body = await res.json().catch(() => ({ error: `Backend answered ${res.status}` }));
    return NextResponse.json(body, { status: res.status });
  } catch { return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 }); }
}
