import { NextResponse } from 'next/server';

/**
 * Stations whose live URL is not fixed, resolved when zecAmp tunes in:
 *  - kbs:    KBS World signs its link for about 48h; read a fresh one off its player page.
 *  - wefunk: WEFUNK's public link redirects to a rotating node WITHOUT CORS
 *            headers; the nodes themselves have them, so pick one from its playlist.
 * Cached for an hour.
 */
export const revalidate = 3600;

const RESOLVERS: Record<string, () => Promise<string | undefined>> = {
  kbs: async () => {
    const page = await fetch('https://world.kbs.co.kr/service/inc/aod.htm?lang=e&vod_division=live&ch=&playing=', { next: { revalidate } }).then((r) => r.text());
    return page.match(/https:\/\/[a-z0-9.-]+\.kbs\.co\.kr\/[^"'\s<>]+\.m3u8\?[^"'\s<>]+/i)?.[0]?.replace(/&amp;/g, '&');
  },
  wefunk: async () => {
    const list = await fetch('https://www.wefunkradio.com/play/radio.m3u', { next: { revalidate } }).then((r) => r.text());
    const nodes = list.split(/\s+/).filter((l) => /^https:\/\/[a-z0-9-]+\.wefunkradio\.com(:\d+)?\//i.test(l));
    return nodes[Math.floor(Math.random() * nodes.length)];
  },
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolve = RESOLVERS[(await params).id];
  if (!resolve) return NextResponse.json({ error: 'Unknown station' }, { status: 404 });
  try {
    const url = await resolve();
    return url ? NextResponse.json({ url }) : NextResponse.json({ error: 'Stream not found' }, { status: 502 });
  } catch {
    return NextResponse.json({ error: 'Station unreachable' }, { status: 503 });
  }
}
