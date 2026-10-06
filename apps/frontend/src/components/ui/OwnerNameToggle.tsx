'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';

/**
 * "Show my name on my Pools": one switch per account, off by default. When
 * on, the Marketplace, the Pool page and the Pools info box name this account
 * (and its badges) as the owner instead of showing nothing about who holds it.
 *
 * Shown in My Pools and in the Account window; both read and write the same
 * server-side setting, and a change in one updates the other at once.
 */

let value: boolean | null = null;
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
const set = (v: boolean) => { value = v; listeners.forEach((f) => f()); };

export function OwnerNameToggle({ compact = false }: { compact?: boolean }) {
  const token = useAuthStore((s) => s.sessionToken);
  const verified = useAuthStore((s) => s.isVerified);
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    if (token && loadedFor !== token) {
      loadedFor = token;
      fetch('/api/user/profile', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j && typeof j.showOwnerName === 'boolean') set(j.showOwnerName); })
        .catch(() => { loadedFor = null; });
    }
    return () => { listeners.delete(f); };
  }, [token]);

  if (!token || !verified || value === null) return null;
  const on = value;
  const flip = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/user/owner-name', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ on: !on }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) set(Boolean(j.showOwnerName)); else setErr(j.error ?? 'Could not save');
    } catch { setErr('Could not save'); } finally { setBusy(false); }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button" role="switch" aria-checked={on} disabled={busy} onClick={() => void flip()}
        title={on ? 'Your name shows as the owner of your Pools. Click to hide it.' : 'Your Pools show no owner. Click to show your name instead.'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, cursor: busy ? 'wait' : 'pointer',
          font: 'inherit', fontSize: compact ? 12 : 13, fontWeight: 700, whiteSpace: 'nowrap',
          padding: compact ? '4px 10px 4px 5px' : '6px 12px 6px 6px', borderRadius: 999,
          border: `1px solid ${on ? '#3fcfa9' : 'var(--pl-border, #444)'}`,
          background: on ? 'rgba(63,207,169,.14)' : 'transparent', color: on ? '#a6ffe2' : 'var(--pl-dim, #aaa)',
        }}
      >
        <span aria-hidden style={{ width: 28, height: 16, borderRadius: 99, position: 'relative', flexShrink: 0,
          background: on ? '#3fcfa9' : 'rgba(255,255,255,.18)', transition: 'background .15s' }}>
          <span style={{ position: 'absolute', top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: '50%',
            background: '#fff', transition: 'left .15s' }} />
        </span>
        {on ? 'Name shown on my Pools' : 'Show my name on my Pools'}
      </button>
      {err && <span style={{ color: '#ff9f45', fontSize: 12 }}>{err}</span>}
    </span>
  );
}
