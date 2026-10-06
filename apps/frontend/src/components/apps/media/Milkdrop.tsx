'use client';

import { useEffect, useRef, useState } from 'react';
import { useZecamp, zecampAudio } from '@/lib/zecamp/engine';
import type { Visualizer } from 'butterchurn';

/**
 * MILKDROP: the classic visualiser, through butterchurn (its WebGL port, MIT),
 * listening to whatever zecAmp is playing. Loaded only when opened, so the
 * player itself stays light. Presets drift from one to the next with a blend;
 * arrows or a click change them by hand.
 *
 * It listens to zecAmp's own audio graph, so it needs something to have played
 * (a browser starts audio only on a gesture), and a radio station that sends
 * no CORS header plays outside that graph, which leaves Milkdrop nothing to hear.
 */
const CYCLE_MS = 25_000;
/** Frame-rate caps the fps button cycles through; 0 = as fast as the screen refreshes. */
const FPS_STEPS = [30, 60, 0];
const FPS_KEY = 'zecamp:milkdrop-fps';
const BLEND_S = 2.7;

/** `onClose`: shown over zecAmp (standalone). Without it, it is a desktop window and the window's own close button closes it. */
export default function Milkdrop({ onClose }: { onClose?: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizRef = useRef<Visualizer | null>(null);
  const presetsRef = useRef<{ names: string[]; all: Record<string, object> } | null>(null);
  const [name, setName] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cap, setCap] = useState(() => { try { const raw = localStorage.getItem(FPS_KEY); return raw !== null && FPS_STEPS.includes(Number(raw)) ? Number(raw) : 60; } catch { return 60; } });
  const capRef = useRef(cap);
  capRef.current = cap;
  /** Frames actually drawn in the last second, shown on the button. */
  const [fps, setFps] = useState(0);
  const cycleFps = () => setCap((c) => {
    const n = FPS_STEPS[(FPS_STEPS.indexOf(c) + 1) % FPS_STEPS.length]!;
    try { localStorage.setItem(FPS_KEY, String(n)); } catch { /* private mode */ }
    return n;
  });
  const noCors = useZecamp((s) => Boolean(s.station?.noCors));

  const load = (step: number | 'random') => {
    const viz = vizRef.current, p = presetsRef.current;
    if (!viz || !p) return;
    const at = p.names.indexOf(name);
    const i = step === 'random' ? Math.floor(Math.random() * p.names.length) : (at + step + p.names.length) % p.names.length;
    viz.loadPreset(p.all[p.names[i]!]!, step === 'random' ? BLEND_S : 0.8);
    setName(p.names[i]!);
  };
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { boxRef.current?.focus(); }, []);

  useEffect(() => {
    let raf = 0, poll = 0, live = true;
    let node: AudioNode | null = null;
    let ro: ResizeObserver | null = null;
    const start = async () => {
      const [{ default: butterchurn }, { default: presets }] = await Promise.all([import('butterchurn'), import('butterchurn-presets')]);
      if (!live) return;
      const audio = zecampAudio();
      if (!audio) { setWaiting(true); poll = window.setTimeout(() => void start(), 600); return; }
      setWaiting(false);
      const canvas = canvasRef.current!, box = boxRef.current!;
      const size = () => {
        const w = box.clientWidth, h = box.clientHeight;
        canvas.width = Math.round(w * devicePixelRatio); canvas.height = Math.round(h * devicePixelRatio);
        vizRef.current?.setRendererSize(canvas.width, canvas.height);
      };
      try {
        vizRef.current = butterchurn.createVisualizer(audio.ctx, canvas, { width: box.clientWidth * devicePixelRatio, height: box.clientHeight * devicePixelRatio, pixelRatio: 1 });
      } catch {
        setError('Milkdrop needs WebGL 2, which this browser does not offer.');
        return;
      }
      node = audio.node;
      vizRef.current.connectAudio(node);
      const all = presets.getPresets();
      presetsRef.current = { names: Object.keys(all), all };
      size();
      ro = new ResizeObserver(size); ro.observe(box);
      loadRef.current('random');
      // Draw only when the cap allows (a 2ms slack keeps 60 on a 60Hz screen from dropping frames).
      let last = 0, frames = 0, second = performance.now();
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        const c = capRef.current;
        if (c && now - last < 1000 / c - 2) return;
        last = now; frames++;
        vizRef.current?.render();
        if (now - second >= 1000) { setFps(Math.round((frames * 1000) / (now - second))); frames = 0; second = now; }
      };
      raf = requestAnimationFrame(tick);
    };
    void start();
    return () => {
      live = false; cancelAnimationFrame(raf); clearTimeout(poll); ro?.disconnect();
      if (node) vizRef.current?.disconnectAudio(node);
      vizRef.current = null;
    };
  }, []);

  // Drift to a new preset while auto is on.
  useEffect(() => {
    if (!auto || !name) return;
    const t = setTimeout(() => loadRef.current('random'), CYCLE_MS);
    return () => clearTimeout(t);
  }, [auto, name]);

  const full = () => {
    const el = boxRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.();
  };

  return (
    <div ref={boxRef} className={`md-box${onClose ? ' md-over' : ''}`} tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); load(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); load(-1); }
        else if (e.key === 'Escape' && !document.fullscreenElement) onClose?.();
      }}>
      <canvas ref={canvasRef} className="md-canvas" onClick={() => load('random')} onDoubleClick={full} />
      {(waiting || error || noCors) && (
        <div className="md-note">
          {error ?? (noCors
            ? 'This station plays outside zecAmp’s audio (its server allows no visualising). Pick another, or play a track.'
            : 'Press play: Milkdrop dances to whatever zecAmp is playing.')}
        </div>
      )}
      <div className="md-bar">
        <button onClick={() => load(-1)} title="Previous preset (←)">{'◀'}</button>
        <span className="md-name" title={name}>{name || 'loading presets…'}</span>
        <button onClick={() => load(1)} title="Next preset (→ or space)">{'▶'}</button>
        <button onClick={() => setAuto((a) => !a)} aria-pressed={auto} className={auto ? 'on' : ''} title="Drift to a new preset every 25 seconds">auto</button>
        <button onClick={cycleFps} className="md-fps" title={`Frame rate: ${cap ? `capped at ${cap}` : 'uncapped'}. Click to cycle 30, 60, max. Now drawing ${fps} fps.`}>
          {cap ? `${cap}` : 'max'} fps<span>{fps || '--'}</span>
        </button>
        <button onClick={full} title="Fullscreen (double-click the picture)">{'⛶'}</button>
        {onClose && <button onClick={onClose} title="Close Milkdrop (Esc)">{'×'}</button>}
      </div>
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
/* In its own window it fills the content area only, so the window's title bar stays on top to drag;
   over zecAmp (standalone) it covers the player. */
.md-box { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; outline: none; }
.md-box.md-over { position: absolute; inset: 0; z-index: 30; }
.md-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: pointer; }
.md-note { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: 80%; text-align: center; color: #cfd8ff; font: 600 14px/1.5 system-ui, sans-serif; text-shadow: 0 1px 4px #000; pointer-events: none; }
.md-bar { position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-radius: 8px;
  background: rgba(8,8,16,.62); backdrop-filter: blur(6px); color: #e8ecff; font: 12px/1 system-ui, sans-serif; opacity: 0; transition: opacity .25s; }
.md-box:hover .md-bar, .md-box:focus-within .md-bar { opacity: 1; }
.md-bar button { font: inherit; font-weight: 700; color: inherit; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: 5px 9px; cursor: pointer; }
.md-bar button:hover { background: rgba(255,255,255,.18); }
.md-bar button.on { color: #0b0b18; background: #b9a6ff; border-color: #b9a6ff; }
.md-fps { font-variant-numeric: tabular-nums; min-width: 104px; display: inline-flex; gap: 6px; justify-content: center; }
.md-fps span { opacity: .6; font-weight: 500; min-width: 3ch; text-align: right; }
.md-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .9; }
@media (hover: none) { .md-bar { opacity: 1; } }
`;
