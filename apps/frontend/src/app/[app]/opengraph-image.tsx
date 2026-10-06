import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { APP_META, getStandaloneMeta, listStandaloneApps } from '@/config/appMeta';
import { PALETTE, spriteFor } from '@/config/appPixelArt';
import { BRAND_PALETTE, ZEC_TILE_GOLD } from '@/config/brandMark';

export const size = { width: 1200, height: 630 };
// No `contentType` export: not every card is a PNG (see ANIMATED). Next still
// emits og:image:type image/png for every card - it derives that from this
// file, and a per-card type needs generateImageMetadata, which would replace
// generateStaticParams and risk these routes rendering on demand, where public/
// is not guaranteed to be on disk. Harmless: each response carries its own
// Content-Type header, which is what crawlers decode by.
export const alt = 'ZEC-OS';

/**
 * Apps whose card is a pre-rendered animation instead of a generated PNG.
 *
 * Crawlers ignore SVG, so an animated logo has to reach them as a GIF - it
 * animates where GIFs do (Discord, Telegram, most chat apps) and shows its
 * first frame everywhere else. Same 1200x630 as every other card, so `size`
 * stays true for all of them. Regenerate with `node tools/pools-og.mjs`.
 */
const ANIMATED: Record<string, string> = {
  pools: 'public/pools/og.gif',
};

/** One card per standalone route, generated at build time. */
export function generateStaticParams() {
  return listStandaloneApps().map((a) => ({ app: a.id }));
}

const BG = '#101015';
const SURFACE = '#1b1b22';
const GOLD = '#e8b53a';
const INK = '#eeecf3';
const MUTED = '#9b9bad';

/** Sprite rendered as a grid of solid blocks - Satori has no canvas. */
function Pixels({ rows, cell, palette = PALETTE }: { rows: string[]; cell: number; palette?: Record<string, string> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((row, y) => (
        <div key={y} style={{ display: 'flex' }}>
          {row.split('').map((ch, x) => (
            <div
              key={x}
              style={{
                width: cell,
                height: cell,
                background: palette[ch] ?? 'transparent',
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ app: string }> }) {
  const { app: id } = await params;

  const animated = ANIMATED[id];
  if (animated) {
    const gif = await readFile(join(process.cwd(), animated));
    return new Response(new Uint8Array(gif), { headers: { 'Content-Type': 'image/gif' } });
  }

  const meta = getStandaloneMeta(id) ?? APP_META.find((a) => a.id === id);
  const title = meta?.title ?? 'ZEC-OS';
  const blurb = meta?.blurb ?? 'Retro OS for Zcash blockchain data';
  const rows = spriteFor(id);
  // The wordmark in the same pixel face as the login screen and the Start menu.
  const pix = await readFile(join(process.cwd(), 'public/fonts/PressStart2P.ttf'));
  // Satori falls back to the first font it is given, so body text needs its own.
  const read = await readFile(join(process.cwd(), 'public/fonts/AtkinsonHyperlegible-Regular.ttf'));
  const bold = await readFile(join(process.cwd(), 'public/fonts/AtkinsonHyperlegible-Bold.ttf'));

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: BG,
          padding: '0 88px',
          fontFamily: 'Read',
          position: 'relative',
        }}
      >
        {/* Warm wash so the card isn't a flat rectangle */}
        <div
          style={{
            position: 'absolute',
            top: -260,
            right: -180,
            width: 760,
            height: 760,
            borderRadius: 760,
            background: 'radial-gradient(circle, rgba(232,181,58,0.16) 0%, rgba(232,181,58,0) 70%)',
            display: 'flex',
          }}
        />

        {/* Brand lockup - boxed Z + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          {/* The Gold Tile: the ZEC-OS mark, 16px art at 6x. */}
          <Pixels rows={ZEC_TILE_GOLD} cell={6} palette={BRAND_PALETTE} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: GOLD, fontSize: 50, fontFamily: 'Pix', marginBottom: 10 }}>
              ZEC-OS
            </div>
            <div style={{ color: MUTED, fontSize: 25 }}>
              Retro OS for Zcash blockchain data
            </div>
          </div>
        </div>

        {/* App identity - sprite + name, beneath the byline */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 30,
            marginTop: 52,
            background: SURFACE,
            borderRadius: 28,
            padding: '30px 40px',
            alignSelf: 'flex-start',
          }}
        >
          <Pixels rows={rows} cell={13} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: GOLD, fontSize: 46, fontWeight: 700 }}>{title}</div>
            <div style={{ color: MUTED, fontSize: 25, marginTop: 6 }}>{blurb}</div>
          </div>
        </div>

        <div style={{ display: 'flex', color: MUTED, fontSize: 22, marginTop: 40 }}>
          zec-os.com/{id}
        </div>
      </div>
    ),
    { ...size, fonts: [
      { name: 'Read', data: read, style: 'normal', weight: 400 },
      { name: 'Read', data: bold, style: 'normal', weight: 700 },
      { name: 'Pix', data: pix, style: 'normal', weight: 400 },
    ] }
  );
}
