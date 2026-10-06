import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

/** Show or hide the caller's name as the owner of their Pools. */
export async function PUT(req: NextRequest) {
  const token = req.headers.get('Authorization');
  try {
    const res = await fetch(`${BACKEND}/api/user/owner-name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}), ...proxyHeaders(req) },
      body: JSON.stringify(await req.json().catch(() => ({}))),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
