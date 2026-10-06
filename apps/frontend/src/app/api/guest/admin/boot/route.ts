import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('Authorization');
    const res = await fetch(`${BACKEND}/api/guest/admin/boot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}), ...proxyHeaders(req) },
      body: JSON.stringify(await req.json().catch(() => ({}))),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch { return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 }); }
}
