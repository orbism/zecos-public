'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { playSoundGlobal } from '@/hooks/useSound';

// Sysop ↔ guest wire. Guests have no account, so they aren't in the DM system;
// messages flow through the guest heartbeat/reply channel. Portaled to
// document.body so position:fixed is viewport-relative (the BBS window uses a
// CSS transform via react-rnd, which would otherwise offset the drag).

interface Msg { from: 'sysop' | 'guest'; body: string; at: number }
const Y = { edge: '#f4b728', bg: '#0b1220', panel: '#111a2b', text: '#e9eef7', dim: '#8a94a6', guest: '#7fd88f' };

export function GuestWire({ guest, token, onClose }: { guest: { guestId: string; name: string | null; ip: string }; token: string; onClose: () => void }) {
  const [thread, setThread] = useState<Msg[]>([]);
  const [online, setOnline] = useState(false);
  const [input, setInput] = useState('');
  const [note, setNote] = useState('');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 360, h: 320 });
  const [mounted, setMounted] = useState(false);
  const winRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const act = useRef<null | { mode: 'drag' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }>(null);
  const seqRef = useRef(0);
  const soundReady = useRef(false);   // skip the initial thread load

  useEffect(() => { setMounted(true); }, []);

  // Long-poll the thread (two-way, near-instant) - held server-side until a
  // message (or ~20s), then re-request immediately.
  useEffect(() => {
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop) return;
      let delay = 300;
      try {
        const r = await fetch(`/api/guest/admin/thread?guestId=${encodeURIComponent(guest.guestId)}&seq=${seqRef.current}`, { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        if (stop) return;
        if (Array.isArray(d?.thread)) {
          const oldSeq = seqRef.current;
          if (soundReady.current && (d.thread as { from: string; seq: number }[]).some((m) => m.from === 'guest' && m.seq > oldSeq)) playSoundGlobal('message');
          setThread(d.thread);
          if (typeof d.seq === 'number') seqRef.current = d.seq;
        }
        setOnline(!!d?.online);
        soundReady.current = true;
      } catch { delay = 2000; }
      if (stop) return;
      timer = setTimeout(loop, delay);
    };
    loop();
    return () => { stop = true; clearTimeout(timer); };
  }, [guest.guestId, token]);

  useEffect(() => { setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 40); }, [thread]);

  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    const r = winRef.current?.getBoundingClientRect(); if (!r) return;
    act.current = { mode: 'drag', sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, ow: 0, oh: 0 }; e.preventDefault();
  };
  const startResize = (e: React.MouseEvent) => {
    act.current = { mode: 'resize', sx: e.clientX, sy: e.clientY, ox: 0, oy: 0, ow: size.w, oh: size.h }; e.preventDefault(); e.stopPropagation();
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const a = act.current; if (!a) return;
      if (a.mode === 'drag') setPos({ x: Math.max(0, a.ox + (e.clientX - a.sx)), y: Math.max(0, a.oy + (e.clientY - a.sy)) });
      else setSize({ w: Math.max(280, a.ow + (e.clientX - a.sx)), h: Math.max(180, a.oh + (e.clientY - a.sy)) });
    };
    const up = () => { act.current = null; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const send = async () => {
    const body = input.trim(); if (!body) return;
    setInput(''); setNote('');
    setThread((p) => [...p, { from: 'sysop', body, at: Date.now() }]); // optimistic
    try {
      const r = await fetch('/api/guest/admin/message', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ guestId: guest.guestId, body }) });
      const d = await r.json();
      if (r.ok && Array.isArray(d?.thread)) { setThread(d.thread); if (typeof d.seq === 'number') seqRef.current = d.seq; } else if (!r.ok) setNote('send failed');
    } catch { setNote('backend unreachable'); }
  };

  const closeWire = async () => {
    try { await fetch('/api/guest/admin/end', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ guestId: guest.guestId }) }); } catch { /* ignore */ }
    onClose();
  };

  if (!mounted) return null;

  const node = (
    <div ref={winRef} style={{ position: 'fixed', ...(pos ? { left: pos.x, top: pos.y } : { bottom: 20, right: 20 }), zIndex: 100001, fontFamily: 'ui-monospace, monospace', width: size.w, height: size.h, border: `2px solid ${Y.edge}`, background: Y.bg, color: Y.text, boxShadow: '0 8px 30px rgba(0,0,0,0.55)', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div onMouseDown={startDrag} style={{ background: Y.edge, color: '#1a1300', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'move', userSelect: 'none', fontWeight: 700, fontSize: 13, borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
        <span>✉ WIRE → {guest.name ? guest.name + ' ' : ''}{guest.guestId.slice(0, 8)}… {online ? '● online' : '○ offline'}</span>
        <button onClick={closeWire} title="close wire (ends the guest's window)" style={{ background: 'transparent', border: 'none', color: '#1a1300', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>✕</button>
      </div>
      <div style={{ padding: '3px 10px', color: Y.dim, fontSize: 10, flexShrink: 0 }}>IP {guest.ip}</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px', fontSize: 13, lineHeight: 1.5 }}>
        {thread.length === 0 && <div style={{ color: Y.dim, fontSize: 12 }}>Say something to open the guest&apos;s chat window.</div>}
        {thread.map((m, i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            <span style={{ color: m.from === 'sysop' ? Y.edge : Y.guest, fontWeight: 700 }}>{m.from === 'sysop' ? 'sysop' : 'guest'}:</span>{' '}
            <span>{m.body}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {note && <div style={{ color: Y.dim, fontSize: 11, padding: '0 10px 2px' }}>{note}</div>}
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: `1px solid ${Y.edge}33` }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="message this guest…" maxLength={500}
          style={{ flex: 1, background: Y.panel, border: `1px solid ${Y.edge}55`, color: Y.text, padding: '5px 9px', outline: 'none', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
        <button onClick={send} style={{ background: Y.edge, border: 'none', color: '#1a1300', padding: '5px 12px', cursor: 'pointer', borderRadius: 6, fontWeight: 700, fontFamily: 'inherit', fontSize: 13 }}>SEND</button>
      </div>
      <div onMouseDown={startResize} title="drag to resize" style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', color: Y.edge, fontSize: 10, lineHeight: '16px', textAlign: 'center', userSelect: 'none' }}>◢</div>
    </div>
  );
  return createPortal(node, document.body);
}
