'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';

/**
 * Moderation (sysop only): find an account, freeze or unfreeze it, and hand
 * out badges. Handles, join dates and badges only: no addresses, IPs or
 * activity are ever shown here.
 */
type User = { id: string; handle: string | null; verified: boolean; frozen: boolean; joined: string; badges: string[] };
type Badge = { key: string; title: string; tooltip: string; image: string };

export default function Moderation() {
  const token = useAuthStore((s) => s.sessionToken);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<User[] | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', tooltip: '', image: '' });

  const call = useCallback(async (url: string, body?: unknown) => {
    const r = await fetch(url, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `${r.status}`);
    return j;
  }, [token]);

  const load = useCallback(async () => {
    try {
      const [u, b] = await Promise.all([call(`/api/moderation/users?q=${encodeURIComponent(q)}`), call('/api/badges')]);
      setUsers(u.users); setBadges(b.badges ?? []); setMsg(null);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }, [call, q]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);

  const act = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    try { await run(); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const readImage = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setForm((x) => ({ ...x, image: String(r.result) }));
    r.readAsDataURL(f);
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4 text-sm">
      <input id="mod-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an account by handle"
        className="w-full px-2 py-1.5 border border-[var(--border-window)] bg-[var(--bg-inset)]" />
      {msg && <div className="text-[var(--accent-orange)]">{msg}</div>}

      <div className="border border-[var(--border-window)] bg-[var(--bg-inset)]">
        {!users ? <div className="p-3 text-[var(--text-muted)]">loading…</div>
          : users.length === 0 ? <div className="p-3 text-[var(--text-muted)]">No accounts found.</div>
          : users.map((u) => (
            <div key={u.id} className="p-3 border-b border-[var(--border-window)] last:border-b-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <b className={u.frozen ? 'text-[var(--accent-orange)]' : ''}>{u.handle ?? '(no handle)'}</b>
                <span className="text-xs text-[var(--text-muted)]">{u.verified ? 'verified' : 'unverified'} · joined {new Date(u.joined).toLocaleDateString()}</span>
                {u.frozen && <span className="text-xs text-[var(--accent-orange)]">frozen</span>}
                <button className="btn-window px-2 py-0.5 text-xs ml-auto" disabled={busy === u.id}
                  onClick={() => void act(u.id, () => call(`/api/moderation/users/${u.id}/freeze`, { frozen: !u.frozen }))}>
                  {u.frozen ? 'Unfreeze' : 'Freeze'}
                </button>
              </div>
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {badges.map((b) => {
                    const has = u.badges.includes(b.key);
                    return (
                      <button key={b.key} title={has ? `Revoke ${b.title}` : `Grant ${b.title}`} disabled={busy === `${u.id}:${b.key}`}
                        onClick={() => void act(`${u.id}:${b.key}`, () => call(`/api/badges/admin/${b.key}/${has ? 'revoke' : 'grant'}`, { userId: u.id }))}
                        className={`flex items-center gap-1 px-1.5 py-0.5 text-xs border ${has ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]' : 'border-[var(--border-window)] text-[var(--text-muted)] opacity-70'}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.image} alt="" width={14} height={14} /> {b.title}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
      </div>

      <div className="border border-[var(--border-window)] bg-[var(--bg-inset)] p-3 space-y-2">
        <div className="text-[var(--text-muted)]">New badge</div>
        <div className="flex flex-wrap gap-2 items-center">
          <input id="mod-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (one word)"
            className="px-2 py-1 border border-[var(--border-window)] bg-[var(--bg-window)] w-36" />
          <input id="mod-tip" value={form.tooltip} onChange={(e) => setForm({ ...form, tooltip: e.target.value })} placeholder="Tooltip"
            className="px-2 py-1 border border-[var(--border-window)] bg-[var(--bg-window)] flex-1 min-w-40" />
          <input id="mod-img" type="file" accept="image/png,image/webp,image/svg+xml" onChange={(e) => readImage(e.target.files?.[0])} className="text-xs" />
          <button className="btn-window px-3 py-1 text-xs" disabled={busy === 'new' || !form.title || !form.tooltip || !form.image}
            onClick={() => void act('new', async () => { await call('/api/badges/admin', form); setForm({ title: '', tooltip: '', image: '' }); })}>
            Create
          </button>
        </div>
        <div className="text-xs text-[var(--text-muted)]">PNG, WebP or SVG under about 45 KB. A frozen account is signed out of everything until unfrozen.</div>
      </div>
    </div>
  );
}
