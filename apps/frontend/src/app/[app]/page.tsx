import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { APP_META, getStandaloneMode, getStandaloneMeta, listStandaloneApps } from '@/config/appMeta';
import { StandaloneApp } from './StandaloneApp';

// Every standalone app id is known ahead of time.
export function generateStaticParams() {
  return listStandaloneApps().map((a) => ({ app: a.id }));
}

/**
 * Fit text to a length budget, ending on a whole sentence where possible.
 *
 * Previews cut mid-word at their own limit, so text that ends on a full
 * sentence below that limit reads better than one the platform chops. But a
 * whole-sentence cut that leaves most of the budget empty (a short first
 * sentence followed by a long second) wastes the preview, so below 60% of the
 * budget it cuts at the last whole word with an ellipsis instead. Splits on
 * sentence-ending punctuation followed by whitespace, so "zec-os.com" or
 * "v1.2" never count as a sentence end.
 */
function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  let out = '';
  for (const sentence of t.split(/(?<=[.!?])\s+/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out.length >= max * 0.6) return out;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:-]+$/, '')}…`;
}

/** Search results show about 60 characters of a title. */
const TITLE_MAX = 60;
/** Google truncates meta descriptions around 150-160 characters. */
const DESCRIPTION_MAX = 155;
/** Social cards often show about 125 characters, less on mobile. */
const OG_DESCRIPTION_MAX = 125;
/** X truncates card descriptions past about 200 characters. */
const TWITTER_DESCRIPTION_MAX = 200;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ app: string }>;
}): Promise<Metadata> {
  const { app: id } = await params;
  const app = getStandaloneMeta(id);
  if (!app) return { title: 'Not found · ZEC-OS' };

  /*
   * "Pools · ZEC-OS" was 14 characters of a 60-character slot. The blurb says
   * what the app is, so it goes in the title too, and the brand drops off
   * rather than the blurb being cut when the three together run long.
   */
  const named = app.blurb ? `${app.title}: ${app.blurb}` : app.title;
  const title = `${named} | ZEC-OS`.length <= TITLE_MAX ? `${named} | ZEC-OS` : clip(named, TITLE_MAX);

  // The long `about` copy runs to ~500 characters; every preview truncates
  // well before that, so each field gets the most that fits its own limit.
  const full = app.about ?? (app.blurb
    ? `${app.blurb}. Part of ZEC-OS, a retro OS for Zcash blockchain data.`
    : `${app.title}: live Zcash network data from ZEC-OS.`);
  const description = clip(full, DESCRIPTION_MAX);
  const ogDescription = clip(full, OG_DESCRIPTION_MAX);
  const twitterDescription = clip(full, TWITTER_DESCRIPTION_MAX);

  // The card image itself comes from the sibling opengraph-image.tsx, which Next
  // wires up automatically; these just make sure both crawlers use the big
  // format rather than a thumbnail.
  return {
    title,
    description,
    /*
     * An app with its own mark gets it as the favicon and the apple touch icon.
     * The SVG scales for the tab; the 512 PNG is for the places that refuse SVG,
     * which is most of the ones that matter on a phone home screen.
     */
    /*
     * An app with its own mark gets it as the favicon and the apple touch icon.
     * The PNG paths are derived from the SVG's own name rather than hardcoded,
     * so a second app with a second mark does not silently inherit the first's
     * raster files - which is exactly what happened when the Marketplace got
     * its own logo.
     */
    ...(app.logo ? (() => {
      const base = app.logo.replace(/\.svg$/, '');
      return {
        icons: {
          icon: [{ url: app.logo }, { url: `${base}-32.png`, sizes: '32x32', type: 'image/png' }],
          apple: [{ url: `${base}-512.png`, sizes: '512x512', type: 'image/png' }],
        },
      };
    })() : {}),
    openGraph: { title, description: ogDescription, type: 'website', siteName: 'ZEC-OS', url: `/${app.id}` },
    twitter: { card: 'summary_large_image', title, description: twitterDescription },
  };
}

export default async function StandaloneAppPage({
  params,
}: {
  params: Promise<{ app: string }>;
}) {
  const { app: id } = await params;
  const meta = APP_META.find((a) => a.id === id);
  const mode = meta ? getStandaloneMode(meta) : null;
  if (!meta || !mode) notFound();

  return <StandaloneApp id={meta.id} mode={mode} />;
}
