import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, getApiHeaders, networkOf, testnetAvailable } from '@/config/api';

export async function GET(request: NextRequest) {
  // Per request, so one person's Explorer choice is theirs alone.
  const net = networkOf(request);
  try {
    const res = await fetch(`${getBaseUrl(net)}/api/chain`, {
      headers: getApiHeaders(net), // Cache for 30 seconds
    });

    if (!res.ok) {
      throw new Error(`API responded with ${res.status}`);
    }

    const data = await res.json();
    /*
     * `networks` says which chains this deployment can answer for.
     *
     * Carried on a route the client already calls, rather than a second
     * endpoint invented for the purpose. The client cannot know whether
     * BACKEND_URL_TESTNET is set, and offering a switch that silently fails is
     * worse than not offering one.
     */
    return NextResponse.json({
      ...data,
      network: net,
      networks: { mainnet: true, testnet: testnetAvailable() },
    });
  } catch (error) {
    console.error('Failed to fetch chain data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chain data' },
      { status: 502 }
    );
  }
}
