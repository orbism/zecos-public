import { NextRequest, NextResponse } from 'next/server';
import { proxyHeaders } from '@/lib/backendHeaders';

const BACKEND = process.env.FASTIFY_URL || 'http://localhost:4000';

// Bearer token + the REAL client IP. The backend's session heartbeat records
// whichever IP it sees, so without this forward every logged-in user is stamped
// with this Next server's address (or nothing) and the sysop roster shows no IPs.
function authHeader(req: NextRequest): Record<string, string> {
  const token = req.headers.get('Authorization');
  return { ...(token ? { Authorization: token } : {}), ...proxyHeaders(req) };
}

export async function GET(req: NextRequest) {
  try {
    const res = await fetch(`${BACKEND}/api/user/game`, { headers: { ...authHeader(req) } });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}

// No PUT - game state is written only by the server engine (/api/rpg/run/*).
