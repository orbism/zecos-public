'use client';

import { useEffect, useRef, useState } from 'react';

// System-wide sysop broadcast. Every client (verified or guest) long-polls the
// broadcast channel; a new message shows as a large orange curved modal, front
// and center, until dismissed.

export function Broadcast() {
  const [msg, setMsg] = useState<{ seq: number; body: string } | null>(null);
  const vRef = useRef(-1);
  const dismissedSeq = useRef(-1);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop) return;
      let delay = 300;
      try {
        const res = await fetch(`/api/broadcast?v=${vRef.current}`);
        const data = await res.json();
        if (stop) return;
        if (typeof data?.v === 'number') vRef.current = data.v;
        const b = data?.broadcast;
        if (b && b.seq > dismissedSeq.current) setMsg({ seq: b.seq, body: b.body });
        else if (!b) setMsg(null);
      } catch { delay = 3000; }
      if (stop) return;
      timer = setTimeout(loop, delay);
    };
    loop();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  if (!msg) return null;

  const dismiss = () => { dismissedSeq.current = msg.seq; setMsg(null); };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100002, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
      <div style={{
        maxWidth: 640, width: '86%', background: '#1a1205', border: '3px solid #ff8c1a',
        borderRadius: 18, boxShadow: '0 20px 70px rgba(0,0,0,0.7), 0 0 40px rgba(255,140,26,0.35)',
        padding: '30px 34px 26px', fontFamily: 'ui-monospace, monospace', color: '#ffe9cf', textAlign: 'center',
      }}>
        <div style={{ color: '#ff8c1a', fontWeight: 800, letterSpacing: 2, fontSize: 14, marginBottom: 14 }}>📢 SYSTEM BROADCAST</div>
        <div style={{ fontSize: 26, lineHeight: 1.4, fontWeight: 700, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.body}</div>
        <button onClick={dismiss} style={{
          marginTop: 24, background: '#ff8c1a', border: 'none', color: '#1a1205', fontWeight: 800,
          fontFamily: 'inherit', fontSize: 15, padding: '9px 26px', borderRadius: 10, cursor: 'pointer',
        }}>DISMISS</button>
      </div>
    </div>
  );
}
