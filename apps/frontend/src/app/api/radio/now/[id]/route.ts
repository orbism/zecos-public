import { NextResponse } from 'next/server';
import { NEWS, MUSIC, type Station } from '@/lib/zecamp/stations';

/**
 * What a station is playing right now, for zecAmp's marquee.
 *
 * Read from the stream itself: ask for ICY metadata, read up to the first
 * metadata block (a few KB) and drop the connection. Almost every station
 * zecAmp carries sends it. HLS and resolved stations have none; a station
 * that only repeats its own name, or sends nothing, answers null.
 */
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; title: string | null }>();
const STATIONS = new Map<string, Station>([...NEWS, ...MUSIC].flatMap((g) => g.stations).map((s) => [s.id, s]));

async function icyTitle(url: string): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'ZEC-OS zecAmp' }, signal: ac.signal, cache: 'no-store' });
    const metaint = Number(res.headers.get('icy-metaint'));
    if (!res.ok || !metaint || !res.body) return null;
    const reader = res.body.getReader();
    let buf = new Uint8Array(0);
    while (buf.length <= metaint || buf.length < metaint + 1 + buf[metaint]! * 16) {
      const { done, value } = await reader.read();
      if (done) break;
      const next = new Uint8Array(buf.length + value.length); next.set(buf); next.set(value, buf.length); buf = next;
      if (buf.length > metaint + 1 + 4080) break;
    }
    const len = (buf[metaint] ?? 0) * 16;
    const meta = new TextDecoder().decode(buf.slice(metaint + 1, metaint + 1 + len));
    return meta.match(/StreamTitle='(.*?)';/)?.[1] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

/** Tidy a title: no stray separators, nothing that only restates the station. */
function clean(raw: string | null, station: Station): string | null {
  const t = (raw ?? '').replace(/\s+/g, ' ').replace(/^[\s\-|:;]+|[\s\-|:;]+$/g, '').trim();
  if (!t) return null;
  const name = station.name.toLowerCase();
  if (t.toLowerCase().includes(name) && t.length <= name.length + 8) return null;
  return t;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const station = STATIONS.get((await params).id);
  if (!station) return NextResponse.json({ error: 'Unknown station' }, { status: 404 });
  const headers = { 'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' };
  if (station.hls || station.resolve || !station.url) return NextResponse.json({ title: null }, { headers });
  const hit = cache.get(station.id);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ title: hit.title }, { headers });
  const title = clean(await icyTitle(station.url), station);
  cache.set(station.id, { at: Date.now(), title });
  return NextResponse.json({ title }, { headers });
}
