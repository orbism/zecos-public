'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { C, FeedbackForm } from './FeedbackForm';

/**
 * Blocking feedback overlay for the standalone routes.
 *
 * Portalled to `document.body` deliberately. Rendered in place it sat inside the
 * standalone footer, whose ancestors establish their own stacking contexts -
 * a `z-index` on a descendant can never escape those, so the panel drew
 * underneath the app content with no way to raise it. A portal moves it out of
 * that subtree entirely, which is the only reliable fix.
 *
 * Everything behind it is dimmed and inert while it's open: the backdrop covers
 * the viewport and swallows clicks (closing the panel), and `overflow: hidden`
 * on <html> stops the page scrolling underneath.
 */
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', esc);
      document.documentElement.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Above every other fixed layer in the app (the donation panel tops out
        // at 9991; the sysop ticket modal at 99999).
        zIndex: 2147483000, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg, border: `2px solid ${C.edge}`,
          boxShadow: `0 0 0 1px ${C.bar}, 5px 5px 0 ${C.bar}`,
          width: 460, maxWidth: '100%', maxHeight: '88vh',
          display: 'flex', flexDirection: 'column', fontFamily: 'monospace',
        }}
      >
        <div style={{
          background: C.bar, padding: '5px 10px', flexShrink: 0,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: `1px solid ${C.edge}`,
        }}>
          <span style={{ color: C.title, fontSize: 'var(--font-size-trinket)', letterSpacing: 0.5 }}>
            📮  Suggestion Box
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#AAAAAA', cursor: 'pointer',
            fontSize: 'var(--font-size-trinket)', fontFamily: 'monospace', lineHeight: 1, padding: '0 2px',
          }}>✕</button>
        </div>

        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          <FeedbackForm onDone={onClose} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
