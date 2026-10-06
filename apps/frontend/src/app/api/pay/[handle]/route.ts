import { NextRequest } from 'next/server';
import { fwd } from '../../_fwd';

/** Pay Me: a public page by handle. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return fwd(req, `/api/pay/${encodeURIComponent(handle)}`);
}
