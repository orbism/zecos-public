'use client';

import { UserBadges } from '@/components/ui/UserBadges';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useZimStore, openZim, openZimChat, zim, markZimUsed, markZimSaid, zimMaySpeak, type ZimPerson } from '@/store/zimStore';
import ZimIcon from './ZimIcon';
import Avatar from './Avatar';
import { sayYouHaveMessages, sayCheesy, popIn } from './sounds';

const POLL_MS = 10_000;
/** Well inside the promised three seconds of signing in. */
const FIRST_CHECK_MS = 1200;

/**
 * ZIM in the taskbar: a count of unread messages, and the way in.
 *
 * With nothing unread a click opens the buddy list. With messages waiting it
 * drops down "3 messages from alice" rows that go straight to that chat, plus
 * the buddy list itself.
 *
 * It also does the talking. Sign-in with messages waiting gets the plain
 * "You have messages". A message arriving later pops, and gets one of the
 * cheesy lines - once, and then not again until ZIM has sat unused for a
 * while with something still unread.
 */
export function ZimTray() {
  const ready = useAuthStore((s) => Boolean(s.sessionToken && s.isVerified && !s.isGuest));
  const unread = useZimStore((s) => s.unread);
  const refresh = useZimStore((s) => s.refreshUnread);
  const [open, setOpen] = useState(false);
  const [senders, setSenders] = useState<ZimPerson[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    let prev: number | null = null;
    const check = async () => {
      await refresh();
      const n = useZimStore.getState().unread;
      if (prev !== null && n > prev) popIn();
      if (n > 0 && zimMaySpeak()) {
        if (prev === null) sayYouHaveMessages(); else sayCheesy();
        markZimSaid();
      }
      prev = n;
    };
    const first = setTimeout(check, FIRST_CHECK_MS);
    const id = setInterval(check, POLL_MS);
    window.addEventListener('focus', check);
    return () => { clearTimeout(first); clearInterval(id); window.removeEventListener('focus', check); };
  }, [ready, refresh]);

  // Close the dropdown on any press outside it.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  if (!ready) return null;

  const click = async () => {
    markZimUsed();
    if (!unread) { openZim(); return; }
    if (open) { setOpen(false); return; }
    setOpen(true); setSenders(null);
    try {
      const d = await zim<{ buddies: ZimPerson[]; incoming: ZimPerson[]; outgoing: ZimPerson[] }>('buddies');
      const seen = new Set<string>();
      setSenders([...d.buddies, ...d.incoming, ...d.outgoing]
        .filter((p) => p.unread > 0 && !seen.has(p.id) && seen.add(p.id))
        .sort((a, b) => b.unread - a.unread));
    } catch { setSenders([]); }
  };

  const row = 'w-full px-3 py-2 text-left hover:bg-[var(--accent-gold)]/20 flex items-center gap-2 text-[var(--text-primary)]';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={click}
        className="btn-window px-2 py-1 flex items-center relative"
        title={unread ? `ZIM: ${unread} unread message${unread === 1 ? '' : 's'}` : 'ZIM - Zcash Instant Messenger'}
        aria-label={unread ? `ZIM, ${unread} unread` : 'ZIM'}
        style={{ fontSize: 'var(--font-size-menu)' }}
      >
        <span className="text-[var(--text-muted)]"><ZimIcon size={18} /></span>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -4, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: '#e5383b', color: '#fff', fontSize: 10, fontWeight: 800,
            lineHeight: '16px', textAlign: 'center', boxShadow: '0 0 0 2px var(--bg-taskbar, #111)',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 bg-[#1a1a2e] window-border z-[9999] py-1" style={{ width: 270 }}>
          {senders === null && <div className="px-3 py-2 text-[var(--text-muted)]" style={{ fontSize: 12 }}>Checking…</div>}
          {senders?.map((p) => (
            <button key={p.id} className={row} style={{ fontSize: 'var(--font-size-menu)' }}
              onClick={() => { setOpen(false); markZimUsed(); openZimChat(p); }}>
              <Avatar avatar={p.avatar} size={24} online={p.online} />
              <span className="truncate">
                <b style={{ color: '#F4B728' }}>{p.unread}</b> message{p.unread === 1 ? '' : 's'} from <b>{p.handle}</b><UserBadges keys={p.badges} size={12} />
              </span>
            </button>
          ))}
          <div className="border-t border-[var(--border-window)] my-1" />
          <button className={row} style={{ fontSize: 'var(--font-size-menu)' }} onClick={() => { setOpen(false); openZim(); }}>
            <ZimIcon size={18} /> Open ZIM
          </button>
        </div>
      )}
    </div>
  );
}
