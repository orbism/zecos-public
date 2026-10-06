'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { playSoundGlobal } from '@/hooks/useSound';
import { currentActivity } from '@/lib/activity';

// Gives each GUEST instance a persistent id + heartbeat so the sysop can see it,
// and a two-way chat window when the sysop opens a wire. Guests cannot close the
// window (only the sysop ends it). Yellow, curved-edge design.

interface Msg { from: 'sysop' | 'guest'; body: string; at: number }
const Y = { edge: '#f4b728', bg: '#0b1220', panel: '#111a2b', text: '#e9eef7', dim: '#8a94a6', you: '#7fd88f' };

function guestId(): string {
  try {
    let id = localStorage.getItem('zec-os-guest-id');
    if (!id) {
      id = 'g-' + (crypto.randomUUID?.() ?? Math.random().toString(16).slice(2) + Date.now().toString(16));
      localStorage.setItem('zec-os-guest-id', id);
    }
    return id;
  } catch { return 'g-' + Math.random().toString(16).slice(2); }
}

export function GuestPresence() {
  const { isGuest, displayName, logout } = useAuthStore();
  const [thread, setThread] = useState<Msg[]>([]);
  const [booted, setBooted] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const idRef = useRef<string>('');
  const seqRef = useRef(0);          // last message seq we've seen (long-poll cursor)
  const soundReady = useRef(false);  // skip the initial thread load
  const endRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | { sx: number; sy: number; ox: number; oy: number }>(null);

  const open = booted === null && thread.length > 0;

  useEffect(() => {
    if (!isGuest) return;
    idRef.current = guestId();
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    // Long-poll: each request is held server-side until a message/boot/end (or
    // ~20s), then we re-request immediately - near-instant delivery.
    const loop = async () => {
      if (stop) return;
      let delay = 300; // small floor between polls
      try {
        const res = await fetch('/api/guest/ping', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guestId: idRef.current, name: displayName || null, seq: seqRef.current, activity: currentActivity() }),
        });
        const data = await res.json();
        if (stop) return;
        if (data?.booted) {
          // Drop to the splash (NOT a reload - a reload would re-enter guest mode
          // and, if banned, bounce in a loop). logout() clears guest → SplashGate
          // shows the entry screen and this heartbeat stops.
          setBooted(data.reason || 'You were removed by the sysop.');
          setTimeout(() => { try { logout(); } catch { /* ignore */ } }, 3500);
          return;
        }
        if (data?.ended) { setThread([]); }             // sysop closed the wire
        else if (Array.isArray(data?.thread)) {
          const oldSeq = seqRef.current;
          if (soundReady.current && (data.thread as { from: string; seq: number }[]).some((m) => m.from === 'sysop' && m.seq > oldSeq)) playSoundGlobal('message');
          setThread(data.thread);
          if (typeof data.seq === 'number') seqRef.current = data.seq;
        }
        soundReady.current = true;
      } catch { delay = 2000; } // backoff on error
      if (stop) return;
      timer = setTimeout(loop, delay);
    };
    loop();
    return () => { stop = true; clearTimeout(timer); };
  }, [isGuest, displayName, logout]);

  useEffect(() => { if (open) setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 40); }, [thread, open]);

  // drag (guests can move it; they can't close it)
  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
    const r = winRef.current?.getBoundingClientRect(); if (!r) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top }; e.preventDefault();
  };
  useEffect(() => {
    const move = (e: MouseEvent) => { const d = drag.current; if (!d) return; setPos({ x: Math.max(0, d.ox + (e.clientX - d.sx)), y: Math.max(0, d.oy + (e.clientY - d.sy)) }); };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const send = async () => {
    const body = input.trim(); if (!body) return;
    setInput('');
    setThread((p) => [...p, { from: 'guest', body, at: Date.now() }]); // optimistic
    try {
      const res = await fetch('/api/guest/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guestId: idRef.current, body }) });
      const data = await res.json();
      if (data?.booted) { setBooted(data.reason || 'Removed by the sysop.'); setTimeout(() => { try { logout(); } catch { /* ignore */ } }, 3000); return; }
      if (Array.isArray(data?.thread)) { setThread(data.thread); if (typeof data.seq === 'number') seqRef.current = data.seq; }
    } catch { /* the loop will reconcile */ }
  };

  const shell = { position: 'fixed' as const, zIndex: 100000, fontFamily: 'ui-monospace, monospace', border: `2px solid ${Y.edge}`, background: Y.bg, color: Y.text, boxShadow: '0 8px 30px rgba(0,0,0,0.55)', borderRadius: 10 };

  if (booted !== null) {
    return (
      <div style={{ ...shell, top: 14, left: '50%', transform: 'translateX(-50%)', maxWidth: 420, padding: '12px 16px', fontSize: 14, lineHeight: 1.5 }}>
        <b style={{ color: Y.edge }}>⚠ Sysop:</b> {booted}
      </div>
    );
  }
  if (!open) return null;

  return (
    <div ref={winRef} style={{ ...shell, ...(pos ? { left: pos.x, top: pos.y } : { bottom: 20, right: 20 }), width: 340, height: 320, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div onMouseDown={startDrag} style={{ background: Y.edge, color: '#1a1300', padding: '6px 12px', fontWeight: 700, fontSize: 13, cursor: 'move', userSelect: 'none', borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>✉ SYSOP WIRE</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', fontSize: 13, lineHeight: 1.5 }}>
        {thread.map((m, i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            <span style={{ color: m.from === 'sysop' ? Y.edge : Y.you, fontWeight: 700 }}>{m.from === 'sysop' ? 'sysop' : 'you'}:</span>{' '}
            <span>{m.body}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: `1px solid ${Y.edge}33` }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="reply to the sysop…" maxLength={500}
          style={{ flex: 1, background: Y.panel, border: `1px solid ${Y.edge}55`, color: Y.text, padding: '5px 9px', outline: 'none', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
        <button onClick={send} style={{ background: Y.edge, border: 'none', color: '#1a1300', padding: '5px 12px', cursor: 'pointer', borderRadius: 6, fontWeight: 700, fontFamily: 'inherit', fontSize: 13 }}>SEND</button>
      </div>
    </div>
  );
}
