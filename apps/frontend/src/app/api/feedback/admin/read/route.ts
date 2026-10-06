import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

// Bearer token (optional here - a guest may send feedback) plus the real client
// IP, which the backend uses for its per-IP submission cap.
function fwd(req: NextRequest): Record<string, string> {
  const token = req.headers.get('Authorization');
  return { ...(token ? { Authorization: token } : {}), ...proxyHeaders(req) };
}

export async function POST(req: NextRequest) {
  try {
    const res = await fetch(`${BACKEND}/api/feedback/admin/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...fwd(req) },
      body: JSON.stringify(await req.json()),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
