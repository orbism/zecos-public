'use client';

import { useMemo } from 'react';

/**
 * The 404.
 *
 * Next's default is a white page with a thin black line, which on this project
 * reads as "the site is broken" rather than "that address is not a thing". So
 * the page draws what the rest of the app draws: one of the generative scenes,
 * or a Pool, picked at random, with a small card over it.
 *
 * A wrong turn is the cheapest possible moment to show somebody what this place
 * looks like.
 */


/**
 * Twelve, because one gets old the second time somebody mistypes a URL.
 *
 * On brand means the joke is about Zcash and about this app - shielded notes,
 * mempools, unmined blocks, cut Pools - and never about the visitor having done
 * something stupid.
 */
const MESSAGES = [
  'This page is shielded. Rather too well, it turns out.',
  'No note here decrypts to anything.',
  'You have reached a block that was never mined.',
  'That link expired like an unpaid invoice.',
  'Nothing found, and nothing spent.',
  'Somebody cut this one already.',
  'Zero confirmations. Zero page.',
  'Off the end of the chain, past the mempool.',
  'This address is valid. It simply holds nothing.',
  'The water is deep here, and completely empty.',
  'Reorganised out of existence.',
  'Not in this wallet, not on this chain.',
];

export default function NotFound() {
  /*
   * Chosen once per load and never again: useMemo with no dependencies, so a
   * re-render cannot swap the scene or the joke out from under someone who is
   * reading it. Random rather than seeded, for the reason randomScene gives -
   * the same 404 every time is not a 404 worth drawing.
   */
  const message = useMemo(() => MESSAGES[Math.floor(Math.random() * MESSAGES.length)]!, []);
  const backdrop = null;

  return (
    <div style={{
      position: 'fixed', inset: 0, fontFamily: 'var(--font-mono, monospace)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0b0f12', color: '#e9efe9', padding: 16,
    }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, opacity: 0.9, pointerEvents: 'none' }}>
        {backdrop}
      </div>

      <div style={{
        position: 'relative', zIndex: 1, width: 'min(440px, 100%)', padding: '22px 24px',
        borderRadius: 12, border: '1px solid rgba(227,187,106,.34)',
        background: 'rgba(12,16,18,.82)',
        backdropFilter: 'blur(3px)',
        boxShadow: '0 24px 70px rgba(0,0,0,.6)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 2, color: '#e3bb6a', lineHeight: 1 }}>404</div>
        <p style={{ fontSize: 14, lineHeight: 1.7, margin: '12px 0 18px', color: '#c3d3cc' }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="/"
            style={{
              padding: '9px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 700,
              background: '#e3bb6a', color: '#14140e', border: '1px solid #e3bb6a',
            }}
          >Back to ZEC-OS</a>
          <a
            href="/explorer"
            style={{
              padding: '9px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 13,
              color: '#e9efe9', border: '1px solid rgba(233,239,233,.3)',
            }}
          >Open the explorer</a>
        </div>
      </div>
    </div>
  );
}
