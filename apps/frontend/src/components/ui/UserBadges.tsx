'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The badges beside a user's name, wherever it is shown in public.
 *
 * Payloads carry badge KEYS only; the images, titles and tooltips come once
 * from GET /api/badges and are shared by every instance on the page.
 */

export interface BadgeDef { key: string; title: string; tooltip: string; image: string }

let defs: Map<string, BadgeDef> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = fetch('/api/badges', { cache: force ? 'no-store' : 'default' })
    .then((r) => (r.ok ? r.json() : { badges: [] }))
    .then((j: { badges?: BadgeDef[] }) => {
      defs = new Map((j.badges ?? []).map((b) => [b.key, b]));
      listeners.forEach((f) => f());
    })
    .catch(() => { loading = null; });
  return loading;
}

/** After the sysop changes a badge: every badge on the page picks it up. */
export function refreshBadges(): Promise<void> { return load(true); }

export function useBadgeDefs(): Map<string, BadgeDef> | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    if (!defs) void load();
    return () => { listeners.delete(f); };
  }, []);
  return defs;
}

export function UserBadges({ keys, size = 14 }: { keys?: string[] | null; size?: number }) {
  const all = useBadgeDefs();
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const shown = (keys ?? []).map((k) => all?.get(k)).filter((b): b is BadgeDef => Boolean(b));
  if (!shown.length) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle', marginLeft: 4, lineHeight: 0 }}>
      {shown.map((b) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={b.key} src={b.image} alt={b.title} aria-label={`${b.title}: ${b.tooltip}`}
          style={{ height: size, width: 'auto', display: 'block', cursor: 'default' }}
          onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ text: b.tooltip, x: r.left + r.width / 2, y: r.top }); }}
          onMouseLeave={() => setTip(null)}
        />
      ))}
      {tip && typeof document !== 'undefined' && createPortal(
        <span role="tooltip" style={{
          position: 'fixed', left: tip.x, top: tip.y - 6, transform: 'translate(-50%, -100%)', zIndex: 100000,
          background: '#141418', color: '#f3f3f3', border: '1px solid #f4b728', borderRadius: 6,
          padding: '4px 9px', font: '600 12px/1.4 var(--font-sans, system-ui, sans-serif)', whiteSpace: 'nowrap',
          boxShadow: '0 6px 18px rgba(0,0,0,.5)', pointerEvents: 'none',
        }}>{tip.text}</span>,
        document.body,
      )}
    </span>
  );
}
