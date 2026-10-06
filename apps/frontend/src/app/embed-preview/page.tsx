import type { Metadata } from 'next';
import { listStandaloneApps } from '@/config/appMeta';
import { ColourText } from '@/components/Colour';

export const metadata: Metadata = {
  title: 'Embed preview · ZEC-OS',
  description: 'How every standalone app looks when its link is shared.',
  robots: { index: false, follow: false },
};

/**
 * Local check for the social cards.
 *
 * Renders each app's real generated `opengraph-image` inside mock-ups of the
 * places these links actually get pasted, so the card can be judged in context
 * rather than as a bare 1200x630 PNG. Deliberately noindex - it's a dev tool.
 */
export default function EmbedPreviewPage() {
  const apps = listStandaloneApps();

  return (
    <div
      data-scrollable-page
      style={{
        minHeight: '100dvh',
        background: '#101015',
        color: '#eeecf3',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '32px 28px 64px',
      }}
    >
      <header style={{ maxWidth: 1180, margin: '0 auto 28px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Social card preview</h1>
        <p style={{ color: '#9b9bad', fontSize: 14, marginTop: 8, lineHeight: 1.6, maxWidth: 780 }}>
          Each card below is the real <code>opengraph-image</code> Next generates for that route -
          the same PNG X, Discord, Slack and iMessage will fetch. Open a card in a new tab to see it
          at full 1200×630. To verify the tags a crawler reads, view source on the app&apos;s page
          and check <code>og:image</code> / <code>twitter:card</code>.
        </p>
        <p style={{ color: '#9b9bad', fontSize: 13, marginTop: 10 }}>
          {apps.length} standalone apps · card URL pattern <code>/&lt;app&gt;/opengraph-image</code>
        </p>
      </header>

      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))',
          gap: 28,
        }}
      >
        {apps.map((app) => (
          <section key={app.id}>
            {/* Discord/Slack-style unfurl */}
            <div
              style={{
                background: '#1b1b22',
                borderRadius: 14,
                borderLeft: '4px solid #e8b53a',
                padding: 14,
                overflow: 'hidden',
              }}
            >
              <div style={{ color: '#9b9bad', fontSize: 12 }}>zec-os.com</div>
              <div style={{ color: '#6aa9ff', fontSize: 15, fontWeight: 600, marginTop: 2 }}>
                {app.title} · ZEC-OS
              </div>
              <div style={{ color: '#c9c9d6', fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
                <ColourText>{app.about ?? app.blurb ?? ''}</ColourText>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/${app.id}/opengraph-image`}
                alt={`Social card for ${app.title}`}
                width={1200}
                height={630}
                style={{
                  width: '100%',
                  height: 'auto',
                  marginTop: 10,
                  borderRadius: 10,
                  display: 'block',
                  background: '#000',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                marginTop: 8,
                fontSize: 12,
                color: '#9b9bad',
              }}
            >
              <a href={`/${app.id}`} style={{ color: '#e8b53a' }}>/{app.id}</a>
              <a href={`/${app.id}/opengraph-image`} target="_blank" rel="noreferrer" style={{ color: '#6aa9ff' }}>
                card PNG ↗
              </a>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
