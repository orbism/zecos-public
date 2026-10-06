import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, getApiHeaders, networkOf } from '@/config/api';
import { isHex64 } from '../../_params';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ txid: string }> }
) {
  // Per request, so one person's Explorer choice is theirs alone.
  const net = networkOf(request);
  const { txid } = await params;
  if (!isHex64(txid)) return NextResponse.json({ error: 'txid must be a 64-hex hash' }, { status: 400 });

  try {
    const res = await fetch(`${getBaseUrl(net)}/api/tx/${txid}`, {
      headers: getApiHeaders(net),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Transaction not found: ${txid}` },
        { status: 404 }
      );
    }

    const data = await res.json();

    /*
     * A transaction that is not in a block yet.
     *
     * The chain API answers for it - that is how the Explorer can show one at
     * all - but with no height, no blockhash, no time and no confirmations, so
     * the page rendered "0 confirmations" beside empty fields and looked
     * broken rather than pending. The mempool feed knows everything else about
     * it (fee, fee rate, how long it has been waiting, what it depends on), so
     * that is fetched and attached here, and only for a pending one: a
     * confirmed transaction costs the extra call nothing because it never
     * makes it.
     */
    const tx = (data as { data?: Record<string, unknown> })?.data ?? data;
    const pending = tx && typeof tx === 'object'
      && (tx as Record<string, unknown>).in_active_chain === false
      && (tx as Record<string, unknown>).height == null;
    if (pending) {
      try {
        const m = await fetch(`${getBaseUrl(net)}/api/mempool`, { headers: getApiHeaders(net) });
        if (m.ok) {
          const pool = await m.json() as { transactions?: Array<Record<string, unknown>> };
          const mine = pool.transactions?.find((t) => t.txid === txid);
          if (mine) (data as Record<string, unknown>).mempool = mine;
        }
      } catch {
        // The transaction still renders as pending; it simply has no fee line.
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch transaction:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transaction' },
      { status: 502 }
    );
  }
}
