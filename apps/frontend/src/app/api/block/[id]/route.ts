import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, getApiHeaders, networkOf } from '@/config/api';
import { isBlockId } from '../../_params';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Per request, so one person's Explorer choice is theirs alone.
  const net = networkOf(request);
  const { id } = await params;
  if (!isBlockId(id)) return NextResponse.json({ error: 'Block id must be a height or a 64-hex hash' }, { status: 400 });

  try {
    const res = await fetch(`${getBaseUrl(net)}/api/block/${encodeURIComponent(id)}`, {
      headers: getApiHeaders(net),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Block not found: ${id}` },
        { status: 404 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch block:', error);
    return NextResponse.json(
      { error: 'Failed to fetch block' },
      { status: 502 }
    );
  }
}
