import { NextResponse } from 'next/server';
import { API_CONFIG, getApiHeaders } from '@/config/api';

// Proxies the upstream Zakura-only route. A successful response indicates the
// Zakura node is reachable/active; a failure implies it is not the active node.
export async function GET() {
  try {
    const res = await fetch(`${API_CONFIG.baseUrl}/api/zakura`, {
      headers: getApiHeaders(),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, active: false }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ ok: false, active: false, error: 'Zakura node unreachable' }, { status: 503 });
  }
}
