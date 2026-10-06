'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  useZecamp, loadLibrary, play, pause, stop, next, prev, seek, addFiles, removeTracks, moveTrack,
  zecampAnalyser, zecampNow, playStation, openMilkdrop, EQ_LABELS, EQ_PRESETS, type Track, type ZecampTheme, type ZecampVis, type ZecampRepeat,
} from '@/lib/zecamp/engine';
import { NEWS, MUSIC } from '@/lib/zecamp/stations';
import { ZECAMP_THEMES } from './zecampThemes';
import dynamic from 'next/dynamic';

// Loaded only when opened: butterchurn and its presets are heavy, and WebGL-only.
const Milkdrop = dynamic(() => import('./Milkdrop'), { ssr: false });

/**
 * zecAmp: a player in the spirit of the classic one - main window, 10-band
 * equaliser and playlist stacked like the docked original, drawn at its native
 * 275-unit width and zoomed to fit the window.
 *
 * All state and sound live in lib/zecamp/engine; this is only the face, so
 * minimising or closing it never touches playback (the window store decides:
 * minimise keeps playing on the strip, close stops).
 */

const W = 275;
const MAIN_H = 133;
const SHADE_H = 14;
const EQ_H = 116;

export const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
export const trackLabel = (t: Track) => (t.artist ? `${t.artist} - ${t.title ?? t.name}` : t.title ?? t.name);

export default function Zecamp() {
  const s = useZecamp();
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: W * 1.5, h: 700 });
  const [drop, setDrop] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => { void loadLibrary(); }, []);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoom = Math.max(1, Math.min(3, box.w / W));
  const mainH = s.shade ? SHADE_H : MAIN_H;
  const plH = Math.max(58, box.h / zoom - mainH - (s.showEq ? EQ_H : 0));
  const theme = ZECAMP_THEMES[s.theme];

  // Keys, the classic set: z x c v b, arrows seek and volume, Delete removes.
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
    const k = e.key.toLowerCase();
    const act: Record<string, () => void> = {
      z: () => void prev(), x: () => void play(), c: pause, v: stop, b: () => void next(),
      arrowleft: () => seek(zecampNow() - 5), arrowright: () => seek(zecampNow() + 5),
      arrowup: () => useZecamp.setState((p) => ({ volume: Math.min(1, p.volume + 0.05) })),
      arrowdown: () => useZecamp.setState((p) => ({ volume: Math.max(0, p.volume - 0.05) })),
    };
    if (act[k]) { e.preventDefault(); act[k](); }
  };

  return (
    <div
      ref={rootRef} tabIndex={0} onKeyDown={onKey} data-own-buttons=""
      onDragOver={(e) => { e.preventDefault(); setDrop(true); }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => { e.preventDefault(); setDrop(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
      style={{ width: '100%', height: '100%', overflow: 'hidden', outline: 'none', background: '#000', position: 'relative', ...(theme.vars as CSSProperties) }}
    >
      <style>{CSS}</style>
      <MenuHost.Provider value={setMenu}>
        <div className="zc" style={{ zoom, width: W, outline: drop ? '2px dashed var(--zc-accent)' : undefined }}>
          <Main />
          {s.showEq && <Eq />}
          {s.showRadio ? <Radio height={plH} /> : <Playlist height={plH} />}
        </div>
      </MenuHost.Provider>
      {menu && <DropMenu menu={menu} root={rootRef.current} close={() => setMenu(null)} />}
      {s.milkdrop && <Milkdrop onClose={() => useZecamp.setState({ milkdrop: false })} />}
    </div>
  );
}

/**
 * What the tuned station is playing, read from its stream (/api/radio/now),
 * refreshed every 20s while it plays. Null when the station does not say.
 */
function useNowPlaying(stationId: string | undefined, playing: boolean): string | null {
  const [now, setNow] = useState<{ id: string; title: string | null } | null>(null);
  useEffect(() => {
    if (!stationId || !playing) return;
    let live = true;
    const read = () => fetch(`/api/radio/now/${encodeURIComponent(stationId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setNow({ id: stationId, title: j?.title ?? null }); })
      .catch(() => {});
    void read();
    const t = setInterval(read, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [stationId, playing]);
  return now && now.id === stationId ? now.title : null;
}

// ── main window ────────────────────────────────────────────────────────────────
function Main() {
  const s = useZecamp();
  const t = s.station ? undefined : s.tracks[s.index];   // on the radio, no track facts (kbps, kHz) apply
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? s.time;
  const dur = s.duration || t?.duration || 0;
  const clock = s.remaining && dur ? `-${fmt(dur - shown)}` : fmt(shown);
  const st = s.station;
  const nowPlaying = useNowPlaying(st?.id, s.playing);
  const title = st ? `${st.name}${nowPlaying ? `: ${nowPlaying}` : ` - ${st.where}`}  [LIVE]${s.radioError ? `  ***  ${s.radioError}` : ''}`
    : t ? `${s.index + 1}. ${trackLabel(t)} (${fmt(t.duration ?? dur)})` : 'zecAmp  ***  drop some mp3s in';
  const fileRef = useRef<HTMLInputElement>(null);

  if (s.shade) {
    return (
      <div className="zc-win" style={{ height: SHADE_H }}>
        <TitleBar label="zecAmp" options>
          <span className="zc-shade-time">{clock}</span>
          <Btn mini onClick={() => void prev()} label="prev">⏮</Btn>
          <Btn mini onClick={() => void play()} label="play">▶</Btn>
          <Btn mini onClick={pause} label="pause">⏸</Btn>
          <Btn mini onClick={stop} label="stop">⏹</Btn>
          <Btn mini onClick={() => void next()} label="next">⏭</Btn>
        </TitleBar>
      </div>
    );
  }

  return (
    <div className="zc-win" style={{ height: MAIN_H }}>
      <TitleBar label="zecAmp" options />
      <div className="zc-row" style={{ padding: '3px 6px 0', gap: 5 }}>
        <div className="zc-lcd" style={{ width: 92, height: 42, position: 'relative' }}>
          <span className="zc-state">{s.playing ? '▶' : s.paused ? '❚❚' : '■'}</span>
          <button className={`zc-clock${s.buffering ? ' zc-blink' : ''}`} title="Elapsed / remaining"
            onClick={() => useZecamp.setState({ remaining: !s.remaining })}>{s.buffering ? '--:--' : clock}</button>
          <Vis />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="zc-lcd zc-marq" title={t ? trackLabel(t) : undefined}>
            <span style={{ animationDuration: `${Math.max(6, title.length * 0.28)}s` }}>{title}&nbsp;&nbsp;***&nbsp;&nbsp;{title}&nbsp;&nbsp;***&nbsp;&nbsp;</span>
          </div>
          <div className="zc-row" style={{ gap: 3, marginTop: 3, alignItems: 'center' }}>
            <span className="zc-lcd zc-tiny">{t?.kbps ?? '--'}</span><span className="zc-lbl">kbps</span>
            <span className="zc-lcd zc-tiny">{t?.khz ?? '--'}</span><span className="zc-lbl">kHz</span>
            <span className={`zc-lbl${t && t.stereo === false ? ' on' : ''}`}>mono</span>
            <span className={`zc-lbl${t && t.stereo !== false ? ' on' : ''}`}>stereo</span>
          </div>
          <div className="zc-row" style={{ gap: 4, marginTop: 4, alignItems: 'center' }}>
            <input className="zc-range" type="range" min={0} max={100} value={Math.round(s.volume * 100)} style={{ width: 68 }}
              title={`Volume ${Math.round(s.volume * 100)}%`} onChange={(e) => useZecamp.setState({ volume: Number(e.target.value) / 100 })} />
            <input className="zc-range" type="range" min={-100} max={100} value={Math.round(s.balance * 100)} style={{ width: 38 }}
              title={s.balance === 0 ? 'Balance: centre' : `Balance: ${Math.abs(Math.round(s.balance * 100))}% ${s.balance < 0 ? 'left' : 'right'}`}
              onChange={(e) => { const v = Number(e.target.value); useZecamp.setState({ balance: Math.abs(v) < 8 ? 0 : v / 100 }); }} />
            <Toggle on={s.showEq} onClick={() => useZecamp.setState({ showEq: !s.showEq })}>EQ</Toggle>
            <Toggle on={s.showPl} onClick={() => useZecamp.setState({ showPl: !s.showPl })}>PL</Toggle>
          </div>
        </div>
      </div>
      <input className="zc-range zc-seek" type="range" min={0} max={1000} disabled={!dur}
        value={dur ? Math.round((shown / dur) * 1000) : 0}
        onChange={(e) => setScrub((Number(e.target.value) / 1000) * dur)}
        onPointerUp={() => { if (scrub !== null) { seek(scrub); setScrub(null); } }}
        onKeyUp={() => { if (scrub !== null) { seek(scrub); setScrub(null); } }} />
      <div className="zc-row" style={{ padding: '0 6px', gap: 2, alignItems: 'center' }}>
        <Btn onClick={() => void prev()} label="Previous (Z)">⏮</Btn>
        <Btn onClick={() => void play()} label="Play (X)">▶</Btn>
        <Btn onClick={pause} label="Pause (C)">⏸</Btn>
        <Btn onClick={stop} label="Stop (V)">⏹</Btn>
        <Btn onClick={() => void next()} label="Next (B)">⏭</Btn>
        <Btn onClick={() => fileRef.current?.click()} label="Open files">⏏</Btn>
        <input ref={fileRef} type="file" accept=".mp3,audio/mpeg" multiple hidden
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="zc-row" style={{ padding: '3px 6px 0', gap: 3, alignItems: 'center' }}>
        <Toggle on={s.showRadio} onClick={() => useZecamp.setState({ showRadio: !s.showRadio, showPl: true })} className="zc-big zc-radio">RADIO</Toggle>
        <Toggle on={s.shuffle} onClick={() => useZecamp.setState({ shuffle: !s.shuffle })} className="zc-big">SHUFFLE</Toggle>
        <RepeatButton mode={s.repeat} />
        <span style={{ flex: 1 }} />
        <button className="zc-milk" onClick={openMilkdrop} title="Open the Milkdrop visualiser">MILKDROP</button>
      </div>
    </div>
  );
}

function TitleBar({ label, options, children }: { label: string; options?: boolean; children?: React.ReactNode }) {
  const s = useZecamp();
  return (
    <div className="zc-title">
      {options
        ? (
          <span className="zc-logo" title="Skins and visualiser">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/zecamp/logo.svg" alt="" />
            <DropButton label="Skins and visualiser" items={[
              { head: 'Skins' },
              ...(Object.keys(ZECAMP_THEMES) as ZecampTheme[]).map((k) => ({ key: `theme:${k}`, label: ZECAMP_THEMES[k].label, on: s.theme === k })),
              { head: 'Visualiser' },
              ...VIS.map(([v, name]) => ({ key: `vis:${v}`, label: name, on: s.vis === v })),
            ]} onPick={(v) => { const [k, x] = v.split(':'); useZecamp.setState(k === 'theme' ? { theme: x as ZecampTheme } : { vis: x as ZecampVis }); }} />
          </span>
        )
        : <span style={{ width: 10 }} />}
      <span className="zc-title-txt">{label}</span>
      {children}
      {options && (
        <button className="zc-shade" title={s.shade ? 'Unroll' : 'Roll up'} onClick={() => useZecamp.setState({ shade: !s.shade })}>{s.shade ? '▾' : '▴'}</button>
      )}
    </div>
  );
}

const VIS: [ZecampVis, string][] = [['spectrum', 'Spectrum'], ['scope', 'Oscilloscope'], ['off', 'Off']];

/**
 * Dropdowns: the button sits in the zoomed player, but the list is drawn in
 * the unzoomed root, at a fixed size in the skin's own colours, placed under
 * its button. (Drawn inside the zoom it grew with the window and its hover
 * rows drifted off their labels.)
 */
interface MenuItem { key?: string; label?: string; on?: boolean; head?: string }
interface Menu { items: MenuItem[]; onPick: (key: string) => void; x: number; y: number }
const MenuHost = createContext<(m: Menu | null) => void>(() => {});

function DropButton({ label, items, onPick, children }: { label: string; items: MenuItem[]; onPick: (k: string) => void; children?: React.ReactNode }) {
  const open = useContext(MenuHost);
  return (
    <button className="zc-over" aria-label={label} aria-haspopup="menu" title={label}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const root = (e.currentTarget.closest('[data-own-buttons]') as HTMLElement).getBoundingClientRect();
        open({ items, onPick, x: r.left - root.left, y: r.bottom - root.top + 2 });
      }}>{children}</button>
  );
}

function DropMenu({ menu, root, close }: { menu: Menu; root: HTMLElement | null; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key); };
  }, [close]);
  // Kept inside the player: flipped left or up when it would run off an edge.
  const w = root?.clientWidth ?? 400, h = root?.clientHeight ?? 600;
  const left = Math.max(4, Math.min(menu.x, w - 164));
  return (
    <div ref={ref} role="menu" className="zc-drop" style={{ left, top: Math.min(menu.y, h - 40), maxHeight: Math.max(80, h - menu.y - 8) }}>
      {menu.items.map((it, i) => it.head
        ? <div key={`h${i}`} className="zc-drop-h">{it.head}</div>
        : <button key={it.key} role="menuitemradio" aria-checked={Boolean(it.on)} className={it.on ? 'on' : ''}
            onClick={() => { menu.onPick(it.key!); close(); }}>{it.label}</button>)}
    </div>
  );
}

function Btn({ children, onClick, label, mini }: { children: React.ReactNode; onClick: () => void; label: string; mini?: boolean }) {
  return <button className={`zc-btn${mini ? ' mini' : ''}`} onClick={onClick} title={label} aria-label={label}>{children}</button>;
}
/** Off, all, one, off: each an icon, the way players show it. */
const REPEAT_NEXT: Record<ZecampRepeat, ZecampRepeat> = { off: 'all', all: 'one', one: 'off' };
const REPEAT_TITLE: Record<ZecampRepeat, string> = { off: 'No repeat', all: 'Repeat all', one: 'Repeat one' };
function RepeatButton({ mode }: { mode: ZecampRepeat }) {
  return (
    <button className={`zc-tog zc-big zc-rep${mode !== 'off' ? ' on' : ''}`} aria-label={REPEAT_TITLE[mode]} title={`${REPEAT_TITLE[mode]} (click: ${REPEAT_TITLE[REPEAT_NEXT[mode]].toLowerCase()})`}
      onClick={() => useZecamp.setState({ repeat: REPEAT_NEXT[mode] })}>
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3" />
        {mode === 'one' && <path d="M11.2 10.4 12.6 9.5v5.2" strokeWidth="2" />}
        {mode === 'off' && <path d="M3 21 21 3" />}
      </svg>
    </button>
  );
}
function Toggle({ on, onClick, children, className = '' }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return <button className={`zc-tog${on ? ' on' : ''} ${className}`} onClick={onClick} aria-pressed={on}>{children}</button>;
}

// ── visualiser ─────────────────────────────────────────────────────────────────
function Vis() {
  const vis = useZecamp((s) => s.vis);
  const theme = useZecamp((s) => s.theme);
  const buffering = useZecamp((s) => s.buffering);   // colours are read from the skin, so a new skin redraws
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || (vis === 'off' && !buffering)) return;
    const g = c.getContext('2d')!;
    const css = getComputedStyle(c);
    const col = (v: string) => css.getPropertyValue(v).trim() || '#0f0';
    const lo = col('--zc-vis-lo'), hi = col('--zc-vis-hi'), top = col('--zc-vis-top'), peakC = col('--zc-peak'), fg = col('--zc-lcd-fg');
    const N = 19;
    const peaks = new Array(N).fill(0);
    let raf = 0;
    const freq = new Uint8Array(1024), wave = new Uint8Array(2048);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const a = zecampAnalyser();
      const w = c.width, h = c.height;
      g.clearRect(0, 0, w, h);
      if (buffering) {
        // Tuning in: a sweep across the display, with a fading trail.
        const t = performance.now() / 900;
        const x = (Math.sin(t * Math.PI) * 0.5 + 0.5) * (w - 24);
        for (let k = 0; k < 6; k++) {
          g.globalAlpha = 1 - k / 6;
          g.fillStyle = k ? lo : top;
          const dx = Math.cos(t * Math.PI) > 0 ? -k * 4 : k * 4;
          g.fillRect(x + dx, h * 0.3, 24, h * 0.4);
        }
        g.globalAlpha = 1;
        return;
      }
      if (!a || !useZecamp.getState().playing) {
        // Idle: the display is on, just quiet (a flat trace, or a floor of empty bars).
        g.fillStyle = lo; g.globalAlpha = 0.45;
        if (vis === 'scope') g.fillRect(0, h / 2 - 0.5, w, Math.max(1, h / 16));
        else for (let i = 0; i < N; i++) g.fillRect(i * (w / N) + 0.5, h - 2, w / N - 1.5, 2);
        g.globalAlpha = 1;
        return;
      }
      if (vis === 'spectrum') {
        a.getByteFrequencyData(freq);
        const grad = g.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, lo); grad.addColorStop(0.6, hi); grad.addColorStop(1, top);
        const bw = w / N;
        for (let i = 0; i < N; i++) {
          // Log-spaced bins, so the bass does not take the whole display.
          const from = Math.floor(Math.pow(i / N, 2) * 380) + 1, to = Math.floor(Math.pow((i + 1) / N, 2) * 380) + 2;
          let v = 0; for (let k = from; k < to; k++) v = Math.max(v, freq[k]!);
          const bh = (v / 255) * h;
          peaks[i] = Math.max(bh, peaks[i] - h * 0.02);
          g.fillStyle = grad;
          g.fillRect(i * bw + 0.5, h - bh, bw - 1.5, bh);
          g.fillStyle = peakC;
          g.fillRect(i * bw + 0.5, h - peaks[i] - 1, bw - 1.5, 1);
        }
      } else {
        a.getByteTimeDomainData(wave);
        g.strokeStyle = fg; g.lineWidth = Math.max(1, h / 16);
        g.beginPath();
        for (let x = 0; x < w; x++) {
          const v = wave[Math.floor((x / w) * wave.length)]! / 255;
          const y = v * h;
          if (x) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [vis, theme, buffering]);
  return (
    <canvas ref={ref} width={152} height={32} className="zc-vis" title="Click: spectrum / oscilloscope / off"
      onClick={() => useZecamp.setState((p) => ({ vis: p.vis === 'spectrum' ? 'scope' : p.vis === 'scope' ? 'off' : 'spectrum' }))} />
  );
}

// ── equaliser ──────────────────────────────────────────────────────────────────
function Eq() {
  const s = useZecamp();
  const setBand = (i: number, v: number) => useZecamp.setState((p) => ({ eq: p.eq.map((x, k) => (k === i ? v : x)) }));
  const curve = useMemo(() => s.eq.map((v, i) => `${i ? 'L' : 'M'}${4 + i * 10.2} ${9 - (v / 12) * 7}`).join(' '), [s.eq]);
  return (
    <div className="zc-win" style={{ height: EQ_H, position: 'relative' }}>
      <TitleBar label="zecAmp EQUALIZER" />
      <div className="zc-row" style={{ padding: '3px 6px', gap: 4, alignItems: 'center' }}>
        <Toggle on={s.eqOn} onClick={() => useZecamp.setState({ eqOn: !s.eqOn })}>ON</Toggle>
        <div className="zc-lcd" style={{ width: 106, height: 18 }}>
          <svg viewBox="0 0 100 18" width="100%" height="100%" preserveAspectRatio="none">
            <line x1="0" x2="100" y1="9" y2="9" stroke="var(--zc-lcd-dim)" strokeWidth="0.6" />
            <path d={curve} fill="none" stroke="var(--zc-lcd-fg)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <span style={{ flex: 1 }} />
        <span className="zc-tog" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          PRESETS
          <DropButton label="EQ presets" items={Object.keys(EQ_PRESETS).map((k) => ({ key: k, label: k }))}
            onPick={(k) => useZecamp.setState({ eq: EQ_PRESETS[k]!.map((v) => Math.max(-12, Math.min(12, v))) })} />
        </span>
      </div>
      <div className="zc-row" style={{ padding: '0 6px', gap: 0, alignItems: 'flex-end' }}>
        <Band label="PRE" value={s.preamp} onChange={(v) => useZecamp.setState({ preamp: v })} />
        <div className="zc-scale"><span>+12</span><span>0</span><span>-12</span></div>
        {s.eq.map((v, i) => <Band key={i} label={EQ_LABELS[i]!} value={v} onChange={(x) => setBand(i, x)} />)}
      </div>
    </div>
  );
}

function Band({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="zc-band" title={`${label}: ${value > 0 ? '+' : ''}${value} dB`}>
      <input className="zc-range zc-vert" type="range" min={-12} max={12} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(0)} />
      <span>{label}</span>
    </label>
  );
}

// ── radio ──────────────────────────────────────────────────────────────────────
function Radio({ height }: { height: number }) {
  const s = useZecamp();
  const [tab, setTab] = useState<'news' | 'music'>(() => (MUSIC.some((g) => g.stations.some((x) => x.id === s.station?.id)) ? 'music' : 'news'));
  const groups = tab === 'news' ? NEWS : MUSIC;
  return (
    <div className="zc-win" style={{ height, display: 'flex', flexDirection: 'column' }}>
      <TitleBar label="zecAmp RADIO" />
      <div className="zc-row" style={{ padding: '3px 4px 0', gap: 2 }}>
        <Toggle on={tab === 'news'} onClick={() => setTab('news')}>NEWS</Toggle>
        <Toggle on={tab === 'music'} onClick={() => setTab('music')}>MUSIC</Toggle>
        <span style={{ flex: 1 }} />
        <Toggle on={false} onClick={() => useZecamp.setState({ showRadio: false })}>PLAYLIST</Toggle>
      </div>
      <div className="zc-list">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="zc-group">{g.label}</div>
            {g.stations.map((x) => (
              <div key={x.id} className={`zc-item${s.station?.id === x.id ? ' cur' : ''}`}
                onDoubleClick={() => void playStation(x)} onClick={() => void playStation(x)} title={`Tune in to ${x.name}`}>
                <span className="zc-t">{s.station?.id === x.id && s.buffering && <span className="zc-spin" aria-label="tuning" />}{x.name}</span>
                <span className="zc-d" style={{ opacity: 0.6 }}>{x.where}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="zc-row" style={{ padding: '2px 6px 3px', alignItems: 'center', minHeight: 12 }}>
        <span className="zc-lcd zc-tiny" style={{ flex: 1, textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {s.station ? `${s.radioError ?? (s.buffering ? 'TUNING…' : s.playing ? 'ON AIR' : 'TUNED')}: ${s.station.name}` : 'Pick a station'}
        </span>
      </div>
    </div>
  );
}

// ── playlist ───────────────────────────────────────────────────────────────────
function Playlist({ height }: { height: number }) {
  const s = useZecamp();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const total = s.tracks.reduce((n, t) => n + (t.duration ?? 0), 0);
  const selTime = s.tracks.filter((t) => sel.has(t.id)).reduce((n, t) => n + (t.duration ?? 0), 0);
  if (!s.showPl) return null;

  const click = (e: React.MouseEvent, t: Track) => {
    setSel((cur) => {
      const n = new Set(e.metaKey || e.ctrlKey ? cur : []);
      if (n.has(t.id) && (e.metaKey || e.ctrlKey)) n.delete(t.id); else n.add(t.id);
      return n;
    });
  };

  return (
    <div className="zc-win" style={{ height, display: 'flex', flexDirection: 'column' }}
      onKeyDown={(e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); removeTracks([...sel]); setSel(new Set()); } }}>
      <TitleBar label="zecAmp PLAYLIST" />
      <div className="zc-list">
        {!s.libraryLoaded && <div className="zc-empty">loading…</div>}
        {s.libraryLoaded && !s.tracks.length && <div className="zc-empty">No tracks yet. Drop mp3s here, or ADD. They stay in this tab only.</div>}
        {s.tracks.map((t, i) => (
          <div key={t.id}
            className={`zc-item${i === s.index ? ' cur' : ''}${sel.has(t.id) ? ' sel' : ''}`}
            draggable onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
            onDrop={(e) => { if (dragFrom !== null) { e.preventDefault(); e.stopPropagation(); moveTrack(dragFrom, i); setDragFrom(null); } }}
            onClick={(e) => click(e, t)} onDoubleClick={() => void play(i)}
            title={t.local ? 'Added from this browser (this tab only)' : undefined}>
            <span className="zc-n">{i + 1}.</span>
            <span className="zc-t">{trackLabel(t)}</span>
            <span className="zc-d">{t.duration ? fmt(t.duration) : ''}</span>
          </div>
        ))}
      </div>
      <div className="zc-row" style={{ padding: '2px 4px', gap: 2, alignItems: 'center' }}>
        <button className="zc-tog" onClick={() => fileRef.current?.click()}>ADD</button>
        <input ref={fileRef} type="file" accept=".mp3,audio/mpeg" multiple hidden
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <button className="zc-tog" disabled={!sel.size} onClick={() => { removeTracks([...sel]); setSel(new Set()); }}>REM</button>
        <button className="zc-tog" onClick={() => setSel(new Set(sel.size === s.tracks.length ? [] : s.tracks.map((t) => t.id)))}>SEL</button>
        <button className="zc-tog" title="Sort by title"
          onClick={() => {
            const cur = s.tracks[s.index];
            const sorted = [...s.tracks].sort((a, b) => trackLabel(a).localeCompare(trackLabel(b), undefined, { numeric: true }));
            useZecamp.setState({ tracks: sorted, index: cur ? sorted.indexOf(cur) : -1 });
          }}>SORT</button>
        <span style={{ flex: 1 }} />
        <span className="zc-lcd zc-tiny" style={{ padding: '0 4px' }}>{fmt(selTime)}/{fmt(total)}</span>
      </div>
    </div>
  );
}

const CSS = `
.zc { font-family: var(--zc-font); font-size: 8px; color: var(--zc-ink); user-select: none; position: relative; }
.zc button { font: inherit; cursor: pointer; min-width: 0; min-height: 0; }  /* the phone tap-target rule; zecAmp is zoomed instead */
.zc-win { background: var(--zc-frame); border: 1px solid var(--zc-lo); box-shadow: inset 1px 1px 0 var(--zc-hi); position: relative; box-sizing: border-box; overflow: hidden; }
.zc-row { display: flex; }
.zc-title { height: 13px; display: flex; align-items: center; gap: 3px; padding: 0 3px; background: var(--zc-title-bg); position: relative; }
.zc-title::before { content: ''; position: absolute; left: 14px; right: 14px; top: 4px; height: 5px; background: var(--zc-title); opacity: .55; pointer-events: none; }
.zc-title-txt { position: relative; padding: 0 4px; margin: 0 auto; background: var(--zc-title-bg); color: var(--zc-title-fg); font-weight: 700; font-size: 7.5px; letter-spacing: 1.2px; }
.zc-logo, .zc-shade { position: relative; overflow: hidden; background: none; border: 0; padding: 0; width: 11px; height: 11px; display: grid; place-items: center; color: var(--zc-title-fg); font-size: 8px; line-height: 1; }
.zc-logo img { width: 10px; height: 10px; display: block; }
.zc-lcd { background: var(--zc-lcd); color: var(--zc-lcd-fg); border: 1px solid var(--zc-lcd-edge); border-radius: var(--zc-radius); box-sizing: border-box; font-family: var(--font-mono, monospace); }
.zc-state { position: absolute; left: 4px; top: 3px; font-size: 7px; color: var(--zc-lcd-fg); }
.zc-clock { position: absolute; left: 16px; top: 1px; background: none; border: 0; padding: 0; color: var(--zc-lcd-fg); font-family: var(--font-mono, monospace) !important; font-size: 15px !important; font-weight: 700; letter-spacing: 1px; line-height: 1; text-shadow: 0 0 3px var(--zc-lcd-fg); }
.zc-vis { position: absolute; left: 4px; bottom: 3px; width: 82px; height: 16px; cursor: pointer; image-rendering: pixelated; }
.zc-marq { height: 13px; overflow: hidden; white-space: nowrap; font-size: 8px; line-height: 11px; padding: 0 3px; }
.zc-marq span { display: inline-block; animation: zc-marq linear infinite; }
@keyframes zc-marq { from { transform: translateX(0) } to { transform: translateX(-50%) } }
.zc-tiny { font-size: 7.5px; padding: 0 3px; line-height: 10px; min-width: 18px; text-align: right; }
.zc-lbl { font-size: 6.5px; opacity: .45; text-transform: uppercase; letter-spacing: .3px; }
.zc-lbl.on { opacity: 1; color: var(--zc-accent); }
.zc-shade-time { font-family: var(--font-mono, monospace); color: var(--zc-lcd-fg); background: var(--zc-lcd); padding: 0 3px; font-size: 7.5px; margin-left: auto; }
.zc-btn { width: 22px; height: 16px; border: 1px solid var(--zc-lo); border-radius: var(--zc-radius); background: var(--zc-btn); color: var(--zc-btn-fg); font-size: 7.5px; line-height: 1; padding: 0; box-shadow: inset 1px 1px 0 var(--zc-hi); }
.zc-btn:active { box-shadow: inset -1px -1px 0 var(--zc-hi); transform: translateY(.5px); }
.zc-btn.mini { width: 11px; height: 9px; font-size: 5.5px; border-width: .5px; }
.zc-tog { height: 10px; padding: 0 4px; border: 1px solid var(--zc-lo); border-radius: var(--zc-radius); background: var(--zc-btn); color: var(--zc-btn-fg); font-size: 6px !important; font-weight: 700; letter-spacing: .4px; line-height: 1; box-shadow: inset 1px 1px 0 var(--zc-hi); }
.zc-tog.on { color: var(--zc-btn-on); text-shadow: 0 0 3px var(--zc-btn-on); }
.zc-tog:disabled { opacity: .45; cursor: default; }
.zc-tog.zc-big { height: 13px; padding: 0 5px; font-size: 8px !important; letter-spacing: .5px; }
.zc-rep { display: inline-grid; place-items: center; width: 20px; padding: 0 !important; }
.zc-rep:not(.on) { opacity: .7; }
.zc-rep.on svg { filter: drop-shadow(0 0 2px var(--zc-btn-on)); }
.zc-milk { height: 13px; padding: 0 10px; border-radius: 3px; border: 1px solid #1a0f33; font-size: 9px !important; font-weight: 900; letter-spacing: 1.6px; color: #fff;
  text-shadow: 0 0 3px #000, 0 0 6px #ff4fd8; background: linear-gradient(100deg, #3b0a6b, #8a1fb3, #ff4fd8, #ff9d2e, #2ee6c8, #3b5bff, #3b0a6b); background-size: 400% 100%;
  animation: zc-milk 8s linear infinite; box-shadow: inset 0 1px 0 #ffffff55, 0 0 6px #8a1fb399; }
.zc-milk:hover { filter: brightness(1.15) saturate(1.2); }
@keyframes zc-milk { from { background-position: 0 0; } to { background-position: 400% 0; } }
@media (prefers-reduced-motion: reduce) { .zc-milk { animation: none; } }
.zc-radio { position: relative; overflow: hidden; color: var(--zc-accent); border-color: var(--zc-accent); animation: zc-radio-glow 2.4s ease-in-out infinite; }
.zc-radio::after { content: ''; position: absolute; inset: -2px auto -2px -60%; width: 45%; background: linear-gradient(100deg, transparent, rgba(255,255,255,.75), transparent); transform: skewX(-20deg); animation: zc-radio-sheen 2.4s ease-in-out infinite; pointer-events: none; }
@keyframes zc-radio-sheen { 0%, 45% { left: -60%; } 85%, 100% { left: 130%; } }
@keyframes zc-radio-glow { 0%, 100% { box-shadow: inset 1px 1px 0 var(--zc-hi), 0 0 0 transparent; } 50% { box-shadow: inset 1px 1px 0 var(--zc-hi), 0 0 5px var(--zc-accent); } }
@media (prefers-reduced-motion: reduce) { .zc-radio, .zc-radio::after { animation: none; } }
.zc-range { -webkit-appearance: none; appearance: none; height: 6px; background: var(--zc-track); border: 1px solid var(--zc-lo); border-radius: 3px; margin: 0; cursor: pointer; }
.zc-range::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 8px; border-radius: 2px; background: var(--zc-thumb); border: .5px solid var(--zc-lo); }
.zc-range::-moz-range-thumb { width: 9px; height: 8px; border-radius: 2px; background: var(--zc-thumb); border: .5px solid var(--zc-lo); }
.zc-seek { display: block; width: 263px; margin: 5px 6px 4px; height: 7px; }
.zc-seek:disabled { opacity: .5; cursor: default; }
.zc-band { display: flex; flex-direction: column; align-items: center; width: 20px; gap: 2px; }
.zc-band span { font-size: 5.5px; opacity: .7; }
.zc-vert { writing-mode: vertical-lr; direction: rtl; width: 6px; height: 56px; }
.zc-scale { display: flex; flex-direction: column; justify-content: space-between; height: 56px; margin: 0 2px 9px; font-size: 5px; opacity: .55; }
.zc-over { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
.zc-drop { position: absolute; z-index: 20; min-width: 160px; overflow-y: auto; padding: 4px 0; font: 12px/1.3 var(--zc-font); background: var(--zc-list); color: var(--zc-list-fg); border: 1px solid var(--zc-lo); border-radius: var(--zc-radius); box-shadow: 0 8px 22px rgba(0,0,0,.55), inset 0 0 0 1px var(--zc-hi); scrollbar-width: thin; scrollbar-color: var(--zc-accent) transparent; }
.zc-drop button { display: block; width: 100%; text-align: left; font: inherit; background: none; border: 0; color: inherit; padding: 5px 12px 5px 24px; cursor: pointer; position: relative; min-width: 0; min-height: 0; }
.zc-drop button:hover, .zc-drop button:focus-visible { background: var(--zc-list-sel); color: var(--zc-list-cur); outline: none; }
.zc-drop button.on { color: var(--zc-list-cur); font-weight: 700; }
.zc-drop button.on::before { content: '✓'; position: absolute; left: 9px; color: var(--zc-accent); }
.zc-drop-h { padding: 7px 12px 3px; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--zc-accent); }
.zc-list { flex: 1; min-height: 0; overflow-y: auto; margin: 2px 4px; background: var(--zc-list); border: 1px solid var(--zc-lo); font-size: 7.5px; scrollbar-width: thin; scrollbar-color: var(--zc-accent) transparent; }
.zc-item { display: flex; gap: 3px; padding: 0 3px; line-height: 10px; color: var(--zc-list-fg); cursor: default; white-space: nowrap; }
.zc-item.cur { color: var(--zc-list-cur); }
.zc-item.sel { background: var(--zc-list-sel); }
.zc-n { opacity: .8; }
.zc-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.zc-spin { display: inline-block; width: 6px; height: 6px; margin-right: 3px; vertical-align: -0.5px; border: 1.2px solid var(--zc-list-cur); border-right-color: transparent; border-radius: 50%; animation: zc-spin .7s linear infinite; }
@keyframes zc-spin { to { transform: rotate(360deg) } }
.zc-blink { animation: zc-blink 1s steps(2) infinite; }
@keyframes zc-blink { 50% { opacity: .25 } }
.zc-group { font-size: 6px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: var(--zc-accent); padding: 4px 3px 1px; opacity: .85; }
.zc-empty { padding: 6px; color: var(--zc-list-fg); opacity: .7; line-height: 1.4; white-space: normal; }
@media (prefers-reduced-motion: reduce) { .zc-marq span, .zc-blink { animation: none; } .zc-spin { animation-duration: 2s; } }
`;
