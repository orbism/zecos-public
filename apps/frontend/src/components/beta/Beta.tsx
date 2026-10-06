'use client';

import { useState } from 'react';
import { useAuthStore, useIsAdmin } from '@/store/authStore';
import { useBeta, useBetaStore } from '@/store/betaStore';

/**
 * The BETA pill: sits right of an app's name in the desktop titlebar and the
 * standalone header, on every beta app, whether or not it is switched live.
 */
export function BetaTag({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      title="Beta: this app works, but it is still experimental."
      style={{
        flexShrink: 0, fontFamily: 'var(--font-mono, monospace)', fontSize: size === 'md' ? 11 : 9.5,
        fontWeight: 800, letterSpacing: '.8px', lineHeight: 1.6,
        padding: '0 5px', borderRadius: 3, cursor: 'help',
        background: '#b26bff22', color: '#c99bff',
        borderWidth: 1, borderStyle: 'solid', borderColor: '#b26bff77',
      }}
    >BETA</span>
  );
}

/**
 * The strip across the top of a beta app's window, saying which mode it is
 * in. The sysop gets the switch right here.
 */
export function BetaBanner({ appId, preview, live }: {
  appId: string;
  /** What the public sees while it is off, e.g. "sample data, inputs locked". */
  preview?: string;
  /** Extra caution while it is live, e.g. "always set a refund address". */
  live?: string;
}) {
  const view = useBeta(appId);
  const admin = useIsAdmin();
  const token = useAuthStore((s) => s.sessionToken);
  const save = useBetaStore((s) => s.save);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!view.beta) return null;

  const flip = async () => {
    if (!token) return;
    setBusy(true); setErr(null);
    setErr(await save({ [appId]: !view.on }, token));
    setBusy(false);
  };

  const text = view.on
    ? `Beta: this works, but it is experimental. Use at your own risk.${live ? ` ${live}` : ''}`
    : view.staffPreview
      ? 'Off for the public, who see the sample preview. You see live data because you are staff.'
      : `Beta preview: ${preview ?? 'sample data only'}. It goes live when the sysop switches it on.`;

  return (
    <div
      role="note"
      className="flex items-center gap-2 px-3 py-1.5 shrink-0"
      style={{
        fontSize: 'calc(var(--font-size-label) * 0.65)', lineHeight: 1.4,
        background: view.on ? '#b26bff14' : '#b26bff22',
        borderBottom: '1px solid #b26bff55', color: 'var(--text-secondary)',
      }}
    >
      <BetaTag />
      <span className="flex-1 min-w-0">{text}{err && <span style={{ color: 'var(--accent-orange)' }}> ({err})</span>}</span>
      {admin && !view.open && (
        <button
          onClick={flip}
          disabled={busy}
          className="btn-window px-2 py-0.5 shrink-0 disabled:opacity-50"
          style={{ fontSize: 'calc(var(--font-size-label) * 0.6)', color: view.on ? 'var(--accent-orange)' : 'var(--accent-green)' }}
          title={view.on ? 'Put it back into preview for the public' : 'Switch it live for everyone'}
        >
          {busy ? '...' : view.on ? 'Back to preview' : 'Go live'}
        </button>
      )}
    </div>
  );
}

/** A small "SAMPLE" stamp for preview-mode panels. */
export function SampleStamp() {
  return (
    <span
      aria-label="sample data"
      style={{
        fontFamily: 'var(--font-mono, monospace)', fontSize: 9, fontWeight: 800, letterSpacing: '.8px',
        padding: '0 4px', borderRadius: 3, color: '#c99bff', border: '1px dashed #b26bff88',
      }}
    >SAMPLE</span>
  );
}
