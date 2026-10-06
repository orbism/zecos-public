import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('Authorization');
    const act = req.headers.get('x-zec-activity');
    const res = await fetch(`${BACKEND}/api/auth/session`, {
      headers: { ...(token ? { Authorization: token } : {}), ...proxyHeaders(req), ...(act ? { 'x-zec-activity': act.slice(0, 2000) } : {}) },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ valid: true }, { status: 200 });
  }
}
