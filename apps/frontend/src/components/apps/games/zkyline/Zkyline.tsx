'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Zkyline as Game, W, H, type Hud } from './engine';
import { music } from './music';

/**
 * Zkyline: a psychedelic rooftop runner. Points are time survived. Verified
 * players' runs are timed by the server (start and finish), so the board
 * cannot be fed more time than really passed.
 */

type Period = 'week' | 'all';
interface Row { rank: number; name: string; tenths: number; mine?: boolean }
interface Result { tenths: number; best?: number; newBest?: boolean; rank?: number; note?: string }

const fmt = (tenths: number) => {
  const m = Math.floor(tenths / 600), s = Math.floor((tenths % 600) / 10), t = tenths % 10;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${t}`;
};
const LOCAL_BEST = 'zkyline:best';
const readBest = () => { try { return Number(localStorage.getItem(LOCAL_BEST)) || 0; } catch { return 0; } };
const writeBest = (v: number) => { try { localStorage.setItem(LOCAL_BEST, String(v)); } catch { /* private window */ } };
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

const PHASE_TINT: Record<string, string> = { MONO: '#d8d8d8', DUSK: '#f29e5c', VAPOR: '#ffaec0', NEON: '#00e5ff', ACID: '#b6ff3a' };

function Board({ period, setPeriod, refresh }: { period: Period; setPeriod: (p: Period) => void; refresh: number }) {
  const token = useAuthStore((s) => s.sessionToken);
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    setRows(null);
    void fetch(`/api/zkyline/board?period=${period}&limit=10`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { rows: [] })).then((j) => setRows(j.rows ?? [])).catch(() => setRows([]));
  }, [period, token, refresh]);
  return (
    <div className="zk-board">
      <div className="zk-tabs">
        {(['week', 'all'] as Period[]).map((p) => <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{p === 'week' ? 'This week' : 'All time'}</button>)}
      </div>
      {!rows && <div className="zk-dim">Loading...</div>}
      {rows && !rows.length && <div className="zk-dim">No runs yet. Be the first.</div>}
      {rows?.map((r) => (
        <div key={r.rank} className={`zk-row${r.mine ? ' me' : ''}`}><span>{r.rank}</span><span className="n">{r.name}</span><span>{fmt(r.tenths)}</span></div>
      ))}
    </div>
  );
}

export default function Zkyline({ windowId }: { windowId?: string }) {
  void windowId;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const runId = useRef<Promise<string | null> | null>(null);
  const [hud, setHud] = useState<Hud>({ tenths: 0, speed: 0, phase: 'MONO', state: 'ready', reason: null, powers: { triple: 0, glide: 0, shield: false } });
  const [best, setBest] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [refresh, setRefresh] = useState(0);
  const [muted, setMuted] = useState(music.muted);
  const token = useAuthStore((s) => s.sessionToken);
  const verified = useAuthStore((s) => s.isVerified);
  const canPost = !!token && verified;

  useEffect(() => setBest(readBest()), []);

  const fresh = useCallback(() => {
    game.current = new Game(newSeed()); setResult(null); setHud(game.current.hud());
    // dev only: lets a test drive the game (jump to a colour phase, measure frames)
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __zk?: Game }).__zk = game.current;
  }, []);

  /** First press of a run: start it, and ask the server to start its clock. */
  const begin = useCallback(() => {
    const g = game.current;
    if (!g || g.state !== 'ready') return;
    runId.current = canPost
      ? fetch('/api/zkyline/start', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' })
        .then((r) => (r.ok ? r.json() : null)).then((j) => (j?.runId as string) ?? null).catch(() => null)
      : null;
  }, [canPost, token]);

  const finish = useCallback(async (g: Game) => {
    const tenths = g.tenths;
    if (tenths > readBest()) { writeBest(tenths); setBest(tenths); }
    const res: Result = { tenths };
    const id = runId.current ? await runId.current : null;
    runId.current = null;
    if (!canPost) res.note = 'Verify your account to get on the leaderboard. Your best is saved in this browser.';
    else if (!id) res.note = 'Could not reach the leaderboard for this run.';
    else {
      try {
        const r = await fetch('/api/zkyline/finish', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ runId: id, tenths, seed: g.seed }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) Object.assign(res, { best: j.best, newBest: j.newBest, rank: j.rank });
        else res.note = j.error ?? 'The leaderboard did not take this run.';
      } catch { res.note = 'Could not reach the leaderboard.'; }
      setRefresh((n) => n + 1);
    }
    setResult(res);
  }, [canPost, token]);

  // the loop: fixed-step physics, one render per frame
  useEffect(() => {
    fresh();
    const ctx = canvas.current!.getContext('2d')!;
    let raf = 0, last = performance.now(), acc = 0, hudAt = 0, reported = false;
    const STEP = 1 / 120;
    const tick = (now: number) => {
      const g = game.current!;
      acc += Math.min(0.1, (now - last) / 1000); last = now;
      while (acc >= STEP) { g.update(STEP); acc -= STEP; }
      g.render(ctx);
      for (const ev of g.events) music.sfx(ev);
      g.events.length = 0;
      music.setMode(g.state === 'run' ? 'run' : g.state === 'paused' ? 'paused' : g.state === 'dead' ? 'dead' : 'menu');
      music.setIntensity((g.speed - 170) / 260);
      if (g.state === 'dead' && !reported) { reported = true; void finish(g); }
      if (g.state !== 'dead') reported = false;
      if (now - hudAt > 100) { hudAt = now; setHud(g.hud()); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const vis = () => { if (document.hidden) game.current?.pause(true); };
    document.addEventListener('visibilitychange', vis);
    host.current?.focus({ preventScroll: true });
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', vis); music.stop(); };
  }, [fresh, finish]);

  const jump = () => {
    music.start();
    const g = game.current; if (!g) return;
    if (g.state === 'dead') { if (result) fresh(); return; }
    if (g.state === 'paused') { g.pause(false); return; }
    if (g.state === 'ready') begin();
    g.press();
  };
  const onKey = (e: React.KeyboardEvent, down: boolean) => {
    const g = game.current; if (!g) return;
    const k = e.code;
    if (['Space', 'ArrowUp', 'KeyW', 'ArrowDown', 'KeyS'].includes(k)) e.preventDefault();
    if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') { if (down && !e.repeat) jump(); if (!down) g.release(); }
    if (k === 'ArrowDown' || k === 'KeyS') g.down(down);
    if (down && (k === 'KeyP' || k === 'Escape')) g.pause(g.state === 'run');
    if (down && k === 'KeyR' && g.state === 'dead' && result) fresh();
    if (down && k === 'KeyM') setMuted(music.toggle());
  };
  // touch: tap to jump, swipe down to slide or drop
  const touch = useRef<{ y: number; t: number } | null>(null);

  const speedPct = Math.round(((hud.speed - 170) / (430 - 170)) * 100);
  return (
    <div ref={host} className="zk" data-own-buttons tabIndex={0} onKeyDown={(e) => onKey(e, true)} onKeyUp={(e) => onKey(e, false)} onBlur={(e) => { if (!host.current?.contains(e.relatedTarget as Node | null)) game.current?.pause(true); }}
      onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button, .zk-board')) return; host.current?.focus({ preventScroll: true }); touch.current = { y: e.clientY, t: Date.now() }; if (e.pointerType === 'mouse') jump(); }}
      onPointerMove={(e) => { if (touch.current && e.clientY - touch.current.y > 28) { game.current?.down(true); touch.current = null; } }}
      onPointerUp={(e) => {
        const g = game.current;
        if (e.pointerType !== 'mouse' && touch.current) jump();
        touch.current = null; g?.release(); g?.down(false);
      }}>
      <style>{CSS}</style>
      <canvas ref={canvas} width={W} height={H} className="zk-canvas" />

      {hud.state !== 'ready' && (
        <div className="zk-hud">
          <div>
            <div className="zk-time">{fmt(hud.tenths)}</div><div className="zk-phase" style={{ color: PHASE_TINT[hud.phase] }}>{hud.phase}</div>
            <div className="zk-powers">
              {hud.powers.triple > 0 && <span>TRIPLE JUMP {Math.ceil(hud.powers.triple)}</span>}
              {hud.powers.glide > 0 && <span>GLIDE {Math.ceil(hud.powers.glide)} <i>hold jump</i></span>}
              {hud.powers.shield && <span>SHIELD</span>}
            </div>
          </div>
          <div className="zk-right">
            <div className="zk-dim">BEST {fmt(Math.max(best, hud.state === 'dead' ? hud.tenths : 0))}</div>
            <button className="zk-mute" onClick={() => setMuted(music.toggle())} title="Music on or off (M)">{muted ? 'MUSIC OFF' : 'MUSIC ON'}</button>
            <div className="zk-speed"><i style={{ width: `${Math.min(100, Math.max(2, speedPct))}%` }} /></div>
          </div>
        </div>
      )}

      {hud.state === 'ready' && (
        <div className="zk-over">
          <div className="zk-card">
            <h1 className="zk-logo">ZKYLINE</h1>
            <p className="zk-dim">Run the rooftops. Don&apos;t get caught. The longer you last, the stranger it gets.</p>
            <div className="zk-keys">
              <span><b>Space / ↑ / tap</b> jump, again in the air to double jump</span>
              <span><b>↓ / swipe down</b> slide on the ground, drop fast in the air</span>
              <span><b>P / Esc</b> pause, <b>M</b> music on or off</span>
              <span>Anything glowing hot will stop you. Awnings bounce. Never jump inside a tunnel.</span>
              <span>Pickups: <b>triple jump</b>, a <b>shield</b> for one hit, a <b>glider</b> (hold jump while falling).</span>
            </div>
            <button className="zk-go" onClick={() => { jump(); host.current?.focus({ preventScroll: true }); }}>RUN</button>
            {!canPost && <p className="zk-dim small">Playing as a guest: verify your account to post times.</p>}
          </div>
          <Board period={period} setPeriod={setPeriod} refresh={refresh} />
        </div>
      )}

      {hud.state === 'paused' && <div className="zk-over"><div className="zk-card"><h2 className="zk-logo sm">PAUSED</h2><p className="zk-dim">Press P, Esc or tap to keep running.</p></div></div>}

      {hud.state === 'dead' && result && (
        <div className="zk-over" onPointerDown={(e) => e.stopPropagation()}>
          <div className="zk-card">
            <div className="zk-dim">{hud.reason?.toUpperCase()}</div>
            <div className="zk-big">{fmt(result.tenths)}</div>
            {result.newBest && <div className="zk-new">NEW WEEKLY BEST</div>}
            {result.rank && <div className="zk-dim">#{result.rank} this week</div>}
            {result.note && <p className="zk-dim small">{result.note}</p>}
            <button className="zk-go" onClick={() => { fresh(); host.current?.focus({ preventScroll: true }); }}>RUN AGAIN</button>
            <div className="zk-dim small">Space or R. A new city every run.</div>
          </div>
          <Board period={period} setPeriod={setPeriod} refresh={refresh} />
        </div>
      )}
    </div>
  );
}

const CSS = `
.zk { position: relative; width: 100%; height: 100%; background: #000; overflow: hidden; outline: none; user-select: none; touch-action: none; font-family: var(--font-mono, ui-monospace, monospace); color: #f2f2f2; }
.zk-canvas { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; display: block; }
.zk-mute { pointer-events: auto; font: inherit; font-size: 11px; letter-spacing: .14em; background: #0008; color: #ddd; border: 1px solid #fff4; padding: 2px 8px; cursor: pointer; }
.zk-powers { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; font-size: 11px; letter-spacing: .14em; font-weight: 800; color: #f6ff3a; }
.zk-powers i { font-style: normal; color: #ccc; font-weight: 400; letter-spacing: .04em; }
.zk-hud { position: absolute; left: 0; right: 0; top: 0; display: flex; justify-content: space-between; padding: 12px 16px; pointer-events: none; text-shadow: 0 2px 0 #000, 0 0 8px #000; }
.zk-time { font-size: 30px; font-weight: 800; letter-spacing: .04em; }
.zk-phase { font-size: 12px; letter-spacing: .3em; font-weight: 700; }
.zk-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.zk-speed { width: 120px; height: 5px; background: #ffffff22; }
.zk-speed i { display: block; height: 100%; background: linear-gradient(90deg, #fff, #ff2e88); }
.zk-dim { color: #bdbdbd; font-size: 13px; }
.zk-dim.small { font-size: 12px; }
.zk-over { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 18px; flex-wrap: wrap; padding: 16px; background: radial-gradient(ellipse at center, #000a, #000d); overflow: auto; }
.zk-card { background: #0b0b0bee; border: 2px solid #f2f2f2; box-shadow: 6px 6px 0 #ff2e88, -6px -6px 0 #00e5ff; padding: 22px 24px; max-width: 420px; display: flex; flex-direction: column; gap: 10px; text-align: center; align-items: center; }
.zk-logo { margin: 0; font-size: 40px; letter-spacing: .18em; font-weight: 900; background: linear-gradient(90deg, #fff, #ff2e88, #00e5ff, #f6ff3a, #fff); background-size: 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: zk-hue 6s linear infinite; }
.zk-logo.sm { font-size: 28px; }
@keyframes zk-hue { to { background-position: 300% 0; } }
.zk-keys { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: #d0d0d0; text-align: left; }
.zk-keys b { color: #fff; }
.zk-go { margin-top: 6px; font: inherit; font-weight: 900; letter-spacing: .2em; font-size: 16px; padding: 10px 28px; background: #f2f2f2; color: #000; border: 0; cursor: pointer; box-shadow: 4px 4px 0 #ff2e88; }
.zk-go:hover { background: #fff; box-shadow: 4px 4px 0 #00e5ff; }
.zk-big { font-size: 44px; font-weight: 900; letter-spacing: .04em; }
.zk-new { color: #f6ff3a; font-weight: 800; letter-spacing: .2em; font-size: 13px; }
.zk-board { background: #0b0b0bee; border: 2px solid #555; padding: 14px 16px; min-width: 240px; display: flex; flex-direction: column; gap: 4px; }
.zk-tabs { display: flex; gap: 6px; margin-bottom: 6px; }
.zk-tabs button { flex: 1; font: inherit; font-size: 12px; padding: 5px; background: transparent; color: #bbb; border: 1px solid #555; cursor: pointer; }
.zk-tabs button.on { background: #f2f2f2; color: #000; border-color: #f2f2f2; }
.zk-row { display: grid; grid-template-columns: 26px 1fr auto; gap: 8px; font-size: 13px; padding: 2px 0; }
.zk-row .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zk-row.me { color: #f6ff3a; }
`;
