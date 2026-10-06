'use client';

import { UserBadges } from '@/components/ui/UserBadges';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useWindowStore } from '@/store/windowStore';
import { zim, useZimStore, markZimUsed, ZIM_CHAT_PREFIX, type ZimPerson } from '@/store/zimStore';
import { copyText } from '@/utils/clipboard';
import Avatar from './Avatar';
import ZimIcon from './ZimIcon';
import MessageText from './MessageText';
import { parseSignal, describeSignal, openZeometry } from '@/components/apps/games/zeometry/net';
import { popIn, popOut } from './sounds';

/**
 * One ZIM conversation: the transcript, "handle: text" the way instant
 * messages always looked, and a box to type in. Enter sends, Shift+Enter is a
 * new line. Opening it marks what they sent you as read.
 */

const POLL_MS = 3000;
const MAX = 1000;
const GOLD = '#F4B728';
const AZURE = '#3ba7ff';

interface Msg { id: string; mine: boolean; body: string; at: string }
interface Thread { peer: Omit<ZimPerson, 'unread'>; canMessage: boolean; messages: Msg[] }

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export default function ZimChat({ windowId }: { windowId?: string }) {
  const peerId = (windowId ?? '').startsWith(ZIM_CHAT_PREFIX) ? windowId!.slice(ZIM_CHAT_PREFIX.length) : '';
  const myHandle = useAuthStore((s) => s.displayName) ?? 'me';
  const [peer, setPeer] = useState<Thread['peer'] | null>(null);
  const [canMessage, setCanMessage] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const lastAt = useRef<string | null>(null);
  /** The message whose text was just copied, for a moment's "copied". */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyMsg = async (m: Msg) => {
    if (await copyText(m.body)) { setCopiedId(m.id); setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1400); }
  };

  const merge = useCallback((incoming: Msg[]) => {
    if (!incoming.length) return;
    setMsgs((cur) => {
      const seen = new Set(cur.map((m) => m.id));
      const next = [...cur, ...incoming.filter((m) => !seen.has(m.id))];
      lastAt.current = next[next.length - 1]?.at ?? lastAt.current;
      return next;
    });
  }, []);

  const poll = useCallback(async () => {
    if (!peerId) return;
    try {
      const q = lastAt.current ? `?after=${encodeURIComponent(lastAt.current)}` : '';
      const t = await zim<Thread>(`messages/${encodeURIComponent(peerId)}${q}`);
      setPeer(t.peer); setCanMessage(t.canMessage); setError(null);
      const first = !lastAt.current;
      if (t.messages.some((m) => !m.mine) || first) void useZimStore.getState().refreshUnread();
      // A new message from them while this is open: pop. Not for the history loaded on opening.
      if (!first && t.messages.some((m) => !m.mine)) { popIn(); markZimUsed(); }
      merge(t.messages);
      // Keep the window's title honest if they rename.
      if (windowId) useWindowStore.getState().updateWindow(windowId, { title: `${t.peer.handle} · Instant Message` });
    } catch (e) { setError(e instanceof Error ? e.message : 'ZIM is unreachable'); }
  }, [peerId, merge, windowId]);

  useEffect(() => {
    markZimUsed();
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Stick to the bottom as messages arrive.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !peerId) return;
    setSending(true); setError(null);
    try {
      const r = await zim<{ message: Msg }>(`messages/${encodeURIComponent(peerId)}`, { method: 'POST', body: { body } });
      merge([r.message]); setDraft('');
      popOut(); markZimUsed();
    } catch (e) { setError(e instanceof Error ? e.message : 'Not sent'); }
    finally { setSending(false); }
  };

  if (!peerId) return <div style={{ padding: 16 }}>No conversation.</div>;

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-inset)', color: 'var(--text-primary)', fontFamily: 'var(--font-primary, system-ui)' }}>
      {/* Who */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
        background: 'linear-gradient(180deg, #1f4fa8 0%, #0e2c6b 55%, #0a1f4d 100%)', borderBottom: `2px solid ${GOLD}`,
      }}>
        {peer ? <Avatar avatar={peer.avatar} size={36} online={peer.online} /> : <span style={{ width: 36, height: 36 }} />}
        <div style={{ flex: 1, minWidth: 0, color: '#fff' }}>
          <div style={{ fontWeight: 800, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{peer?.handle ?? '…'}{peer && <UserBadges keys={peer.badges} />}</div>
          <div style={{ fontSize: 11, color: !peer?.online ? '#9fb3d9' : peer.status === 'away' ? '#f0a93b' : '#7ee787' }}>
            {peer ? (!peer.online ? '○ Offline - they will see it next time' : peer.status === 'away' ? '● Away' : '● Online') : ''}
          </div>
          {peer?.doing && <div style={{ fontSize: 11, fontStyle: 'italic', color: '#cfe0ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{peer.doing}</div>}
        </div>
        <span style={{ color: '#cfe0ff', opacity: 0.9 }}><ZimIcon size={24} /></span>
      </div>

      {/* The copy icon shows on hover (or keyboard focus) only; touch screens,
          which cannot hover, keep it faintly visible. */}
      <style>{`
        .zim-copy { float:right; margin-left:8px; padding:2px 3px; min-width:0; min-height:0; line-height:0; border:0; border-radius:3px;
          background:transparent; color:var(--text-muted); cursor:pointer; opacity:0; transition:opacity .12s; }
        .zim-msg:hover .zim-copy, .zim-copy:focus-visible, .zim-copy.done { opacity:1; }
        .zim-copy:hover { color:var(--text-primary); }
        .zim-copy.done { color:#7ee787; }
        @media (hover: none) { .zim-copy { opacity:.45; } }
      `}</style>
      {/* Transcript */}
      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px', fontSize: 13.5, lineHeight: 1.5, background: 'var(--bg-window)' }}>
        {msgs.length === 0 && !error && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginTop: 20 }}>
            No messages yet. Say hi.
          </div>
        )}
        {msgs.filter((m) => { const s = parseSignal(m.body); return !s || describeSignal(s, m.mine) !== null; }).map((m) => (
          <div key={m.id} className="zim-msg" title={new Date(m.at).toLocaleString()} style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            <button type="button" className={`zim-copy${copiedId === m.id ? ' done' : ''}`} onClick={() => void copyMsg(m)}
              title={copiedId === m.id ? 'Copied' : 'Copy message'} aria-label="Copy message">
              {copiedId === m.id ? (
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
                </svg>
              )}
            </button>
            <span style={{ fontWeight: 800, color: m.mine ? GOLD : AZURE }}>{m.mine ? myHandle : peer?.handle ?? '?'}</span>{!m.mine && peer && <UserBadges keys={peer.badges} size={12} />}
            <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}> ({time(m.at)})</span>
            <span style={{ fontWeight: 800, color: m.mine ? GOLD : AZURE }}>:</span> {(() => { const s = parseSignal(m.body); if (!s) return <MessageText body={m.body} linkColor={AZURE} />;
              return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '2px 8px', borderRadius: 6, border: `1px solid ${GOLD}66`, color: GOLD }}>◇ {describeSignal(s, m.mine)}{s.t === 'invite' && !m.mine && peerId && <button type="button" onClick={() => openZeometry({ peerId, room: s.room, mode: s.mode })} style={{ font: 'inherit', fontWeight: 800, color: '#120e02', background: GOLD, border: 0, borderRadius: 4, padding: '1px 8px', cursor: 'pointer' }}>JOIN</button>}</span>; })()}
          </div>
        ))}
      </div>

      {error && <div style={{ padding: '4px 10px', color: 'var(--accent-orange)', fontSize: 12 }}>{error}</div>}

      {/* Compose */}
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid rgba(0,0,0,.6)' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          disabled={!canMessage}
          placeholder={canMessage ? `Message ${peer?.handle ?? ''}` : 'You can message once you are buddies'}
          rows={3}
          style={{
            flex: 1, resize: 'none', background: 'var(--bg-inset)', color: 'var(--text-primary)', fontSize: 13.5,
            border: '1px solid var(--border-window)', padding: '6px 8px', fontFamily: 'inherit',
          }}
        />
        <button onClick={() => void send()} disabled={!canMessage || sending || !draft.trim()} style={{
          width: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          border: '1px solid rgba(0,0,0,.65)', borderRadius: 4, cursor: 'pointer', font: 'inherit',
          background: 'linear-gradient(#2c3346, #1d2230)', color: GOLD, fontWeight: 800, fontSize: 12,
          boxShadow: 'inset 1px 1px 0 rgba(255,255,255,.14), inset -1px -1px 0 rgba(0,0,0,.45)',
          opacity: !canMessage || !draft.trim() ? 0.5 : 1,
        }}>
          <ZimIcon size={20} />Send
        </button>
      </div>
    </div>
  );
}
