'use client';

import { AppGlyph } from '@/components/ui/ZecIcon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore, useIsAdmin } from '@/store/authStore';

const POLL_MS = 45_000;

export interface Ticket {
  id: string;
  topic: string;
  body: string;
  email: string | null;
  discord: string | null;
  twitter: string | null;
  handle: string | null;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
}

const TOPIC_COLOR: Record<string, string> = {
  suggestion: 'var(--accent-gold)',
  bug: 'var(--accent-orange)',
  collab: 'var(--accent-green)',
  other: 'var(--text-muted)',
};

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * Sysop-only feedback bell.
 *
 * Rendered by the taskbar and gated on `useIsAdmin()` - it returns null for
 * everybody else, and every endpoint behind it re-checks admin server-side, so
 * this is a convenience gate rather than the security boundary.
 */
export function FeedbackBell({ position = 'top' }: { position?: 'top' | 'bottom' }) {
  const isAdmin = useIsAdmin();
  const sessionToken = useAuthStore((s) => s.sessionToken);

  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const auth = useCallback(
    () => ({ Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' }),
    [sessionToken],
  );

  const loadCount = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/feedback/admin/count', { headers: auth(), cache: 'no-store' });
      const d = await res.json();
      if (res.ok && typeof d.unread === 'number') setUnread(d.unread);
    } catch { /* transient - next tick */ }
  }, [sessionToken, auth]);

  const loadTickets = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/feedback/admin/list', { headers: auth(), cache: 'no-store' });
      const d = await res.json();
      if (res.ok) { setTickets(d.tickets ?? []); setUnread(d.unread ?? 0); }
    } catch { /* leave whatever we had */ }
  }, [sessionToken, auth]);

  useEffect(() => {
    if (!isAdmin) return;
    loadCount();
    const iv = setInterval(loadCount, POLL_MS);
    return () => clearInterval(iv);
  }, [isAdmin, loadCount]);

  // Close the dropdown on an outside click, the way the other taskbar popups do.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const markRead = useCallback(async (id?: string) => {
    if (!sessionToken) return;
    // Optimistic - the list is re-fetched right after anyway.
    setTickets((t) => t?.map((x) => (!id || x.id === id) && !x.readAt ? { ...x, readAt: new Date().toISOString() } : x) ?? t);
    try {
      await fetch('/api/feedback/admin/read', {
        method: 'POST', headers: auth(),
        body: JSON.stringify(id ? { id } : { all: true }),
      });
    } finally { loadTickets(); }
  }, [sessionToken, auth, loadTickets]);

  const setResolved = useCallback(async (id: string, resolved: boolean) => {
    if (!sessionToken) return;
    try {
      await fetch('/api/feedback/admin/resolve', {
        method: 'POST', headers: auth(), body: JSON.stringify({ id, resolved }),
      });
    } finally { loadTickets(); }
  }, [sessionToken, auth, loadTickets]);

  if (!isAdmin) return null;

  const dropClass = position === 'bottom' ? 'bottom-full mb-1' : 'top-full mt-1';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen((v) => !v); if (!open) loadTickets(); }}
        className="btn-window px-2 py-1 flex items-center relative"
        title={unread ? `${unread} unread feedback` : 'Feedback inbox'}
        style={{ fontSize: 'var(--font-size-menu)' }}
      >
        <span className={unread ? 'text-[var(--accent-gold)]' : 'text-[var(--text-secondary)]'}><AppGlyph glyph="🔔" size={30} /></span>
        {unread > 0 && (
          <span
            style={{
              position: 'absolute', top: -4, right: -4, minWidth: 15, height: 15,
              padding: '0 3px', borderRadius: 8, background: '#FF3333', color: '#fff',
              fontSize: 9, lineHeight: '15px', textAlign: 'center', fontFamily: 'monospace',
              boxShadow: '0 0 6px rgba(255,51,51,0.9)',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute ${dropClass} right-0 bg-[#1a1a2e] window-border z-[9999] p-2`}
          style={{ width: 320, maxHeight: 380, overflowY: 'auto', fontFamily: 'monospace' }}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[var(--accent-gold)]" style={{ fontSize: 'var(--font-size-label)' }}>
              FEEDBACK {unread > 0 && <span style={{ color: '#FF5555' }}>· {unread} new</span>}
            </span>
            {unread > 0 && (
              <button
                onClick={() => markRead()}
                className="text-[var(--text-secondary)] hover:text-[var(--accent-gold)]"
                style={{ fontSize: 'var(--font-size-label)' }}
              >
                mark all read
              </button>
            )}
          </div>

          {tickets === null && (
            <div className="text-[var(--text-muted)] px-1 py-3" style={{ fontSize: 'var(--font-size-label)' }}>
              loading…
            </div>
          )}
          {tickets?.length === 0 && (
            <div className="text-[var(--text-muted)] px-1 py-3" style={{ fontSize: 'var(--font-size-label)' }}>
              Nothing yet. Enjoy the silence.
            </div>
          )}

          {tickets?.slice(0, 8).map((t) => (
            <button
              key={t.id}
              onClick={() => { markRead(t.id); setShowAll(true); setOpen(false); }}
              className="w-full text-left px-2 py-2 mb-1 hover:bg-[var(--accent-gold)]/10"
              style={{
                borderLeft: `3px solid ${t.readAt ? 'transparent' : '#FF3333'}`,
                background: t.readAt ? 'transparent' : 'rgba(255,51,51,0.06)',
                fontSize: 'var(--font-size-label)',
              }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: TOPIC_COLOR[t.topic] ?? 'var(--text-muted)' }}>{t.topic}</span>
                <span className="text-[var(--text-muted)] ml-auto" style={{ fontSize: 10 }}>{ago(t.createdAt)}</span>
              </div>
              <div className="text-[var(--text-primary)] mt-0.5" style={{ lineHeight: 1.4 }}>
                {t.body.length > 84 ? `${t.body.slice(0, 84)}…` : t.body}
              </div>
            </button>
          ))}

          <button
            onClick={() => { setShowAll(true); setOpen(false); }}
            className="btn-window w-full py-1.5 mt-1 text-[var(--accent-green)]"
            style={{ fontSize: 'var(--font-size-label)' }}
          >
            Open all tickets
          </button>
        </div>
      )}

      {showAll && (
        <TicketsModal
          tickets={tickets}
          onClose={() => setShowAll(false)}
          onRefresh={loadTickets}
          onRead={markRead}
          onResolve={setResolved}
        />
      )}
    </div>
  );
}

// ── All-tickets modal ────────────────────────────────────────────────────────

type Filter = 'unread' | 'open' | 'all';

function TicketsModal({
  tickets, onClose, onRefresh, onRead, onResolve,
}: {
  tickets: Ticket[] | null;
  onClose: () => void;
  onRefresh: () => void;
  onRead: (id?: string) => void;
  onResolve: (id: string, resolved: boolean) => void;
}) {
  const [filter, setFilter] = useState<Filter>('open');

  useEffect(() => { onRefresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const shown = (tickets ?? []).filter((t) =>
    filter === 'all' ? true : filter === 'unread' ? !t.readAt : !t.resolvedAt);

  const C = { edge: '#00AAAA', bar: '#0000AA', title: '#FFFF55' };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 99999, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#060606', border: `2px solid ${C.edge}`,
          boxShadow: `0 0 0 1px ${C.bar}, 5px 5px 0 ${C.bar}`,
          width: 720, maxWidth: '100%', height: '80vh',
          display: 'flex', flexDirection: 'column', fontFamily: 'monospace',
        }}
      >
        <div style={{
          background: C.bar, padding: '5px 10px', flexShrink: 0,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: `1px solid ${C.edge}`,
        }}>
          <span style={{ color: C.title, fontSize: 'var(--font-size-trinket)' }}>
            📮  Feedback Tickets - sysop
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#AAA', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: 'var(--font-size-trinket)', lineHeight: 1,
          }}>✕</button>
        </div>

        <div style={{
          display: 'flex', gap: 6, padding: '8px 12px', flexShrink: 0,
          borderBottom: `1px solid ${C.edge}`, alignItems: 'center',
        }}>
          {(['unread', 'open', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? C.bar : 'transparent',
                border: `1px solid ${filter === f ? '#55FFFF' : C.edge}`,
                color: filter === f ? C.title : '#AAA',
                padding: '3px 10px', cursor: 'pointer',
                fontFamily: 'monospace', fontSize: 'var(--font-size-trinket)',
              }}
            >
              {f}
            </button>
          ))}
          <span style={{ color: '#888', fontSize: 'var(--font-size-trinket)', marginLeft: 4 }}>
            {shown.length} shown
          </span>
          <button
            onClick={() => onRead()}
            style={{
              marginLeft: 'auto', background: 'none', border: `1px solid ${C.edge}`,
              color: '#55FFFF', padding: '3px 10px', cursor: 'pointer',
              fontFamily: 'monospace', fontSize: 'var(--font-size-trinket)',
            }}
          >
            mark all read
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.length === 0 && (
            <div style={{ color: '#888', fontSize: 'var(--font-size-trinket)', padding: 12 }}>
              Nothing here.
            </div>
          )}
          {shown.map((t) => (
            <div
              key={t.id}
              style={{
                border: `1px solid ${t.resolvedAt ? '#2a2a2a' : C.edge}`,
                background: t.readAt ? '#0b0b0b' : 'rgba(255,51,51,0.06)',
                padding: 10, opacity: t.resolvedAt ? 0.6 : 1,
                fontSize: 'var(--font-size-trinket)', lineHeight: 1.6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ color: TOPIC_COLOR[t.topic] ?? '#888', textTransform: 'uppercase' }}>{t.topic}</span>
                {!t.readAt && <span style={{ color: '#FF5555' }}>● new</span>}
                {t.resolvedAt && <span style={{ color: '#55FF55' }}>✓ resolved</span>}
                <span style={{ color: '#888', marginLeft: 'auto' }}>
                  {new Date(t.createdAt).toLocaleString()} · {ago(t.createdAt)}
                </span>
              </div>

              <div style={{ color: '#DDD', whiteSpace: 'pre-wrap', marginBottom: 8 }}>{t.body}</div>

              <div style={{ color: '#888', display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                {t.handle  && <span style={{ color: '#55FFFF' }}>@{t.handle}</span>}
                {t.email   && <span>✉ {t.email}</span>}
                {t.discord && <span>discord: {t.discord}</span>}
                {t.twitter && <span>x: {t.twitter}</span>}
                {t.ip      && <span>ip: {t.ip}</span>}
                {!t.handle && !t.email && !t.discord && !t.twitter && <span>anonymous</span>}
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                {!t.readAt && (
                  <button
                    onClick={() => onRead(t.id)}
                    style={{
                      background: 'none', border: `1px solid ${C.edge}`, color: '#55FFFF',
                      padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace',
                      fontSize: 'var(--font-size-trinket)',
                    }}
                  >
                    mark read
                  </button>
                )}
                <button
                  onClick={() => onResolve(t.id, !t.resolvedAt)}
                  style={{
                    background: 'none',
                    border: `1px solid ${t.resolvedAt ? '#555' : '#55FF55'}`,
                    color: t.resolvedAt ? '#888' : '#55FF55',
                    padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace',
                    fontSize: 'var(--font-size-trinket)',
                  }}
                >
                  {t.resolvedAt ? 'reopen' : 'mark resolved'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
