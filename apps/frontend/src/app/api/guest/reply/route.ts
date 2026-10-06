import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

export async function POST(req: NextRequest) {
  try {
    const res = await fetch(`${BACKEND}/api/guest/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...proxyHeaders(req) },
      body: JSON.stringify(await req.json().catch(() => ({}))),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch { return NextResponse.json({ ok: true }, { status: 200 }); }
}
