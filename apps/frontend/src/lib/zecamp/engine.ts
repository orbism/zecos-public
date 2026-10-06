'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useWindowStore } from '@/store/windowStore';
import { APP_META } from '@/config/appMeta';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { parseMp3, HEAD_BYTES, type Mp3Info } from './mp3info';
import { NEWS, MUSIC, type Station } from './stations';

/**
 * zecAmp's engine: ONE audio element and one Web Audio graph for the whole
 * page, outside any component, so the music outlives the window (minimised to
 * the strip at the bottom) and stops only when the window is closed.
 *
 *   <audio> -> preamp -> 10-band EQ -> balance -> volume -> analyser -> out
 *                                                         \-> splitter -> left / right analysers
 *
 * The analyser is the public tap: the visualiser reads it now, and Pools'
 * sound-reactive water will read the same one later (zecampAnalyser()).
 *
 * The playlist starts as whatever ships in public/music (manifest built at
 * deploy). Files a listener adds live only in this tab, as object URLs: never
 * uploaded, never stored.
 */

export interface Track extends Mp3Info {
  id: string;
  url: string;
  name: string;           // file name, the fallback title
  size?: number;
  local?: boolean;        // added from this browser, this session only
}

export type ZecampTheme = 'base' | 'bento' | 'nucleo';
export type ZecampVis = 'spectrum' | 'scope' | 'off';
export type ZecampRepeat = 'off' | 'all' | 'one';

export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
export const EQ_LABELS = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Classical: [0, 0, 0, 0, 0, 0, -7, -7, -7, -9],
  Club: [0, 0, 8, 5, 5, 5, 3, 0, 0, 0],
  Dance: [9, 7, 2, 0, 0, -5, -7, -7, 0, 0],
  'Full Bass': [-8, 9, 9, 5, 1, -4, -8, -10, -11, -11],
  'Full Treble': [-9, -9, -9, -4, 2, 11, 16, 16, 16, 16],
  Laptop: [4, 11, 5, -3, -2, 1, 4, 9, 12, 14],
  Live: [-5, 0, 4, 5, 5, 5, 4, 2, 2, 2],
  Party: [7, 7, 0, 0, 0, 0, 0, 0, 7, 7],
  Pop: [-1, 4, 7, 8, 5, 0, -2, -2, -1, -1],
  Reggae: [0, 0, 0, -5, 0, 6, 6, 0, 0, 0],
  Rock: [8, 4, -5, -8, -3, 4, 8, 11, 11, 11],
  Soft: [4, 1, 0, -2, 0, 4, 8, 9, 11, 12],
  Techno: [8, 5, 0, -5, -4, 0, 8, 9, 9, 8],
};

interface State {
  tracks: Track[];
  index: number;           // current track, -1 before anything is chosen
  station: Station | null; // a radio station is playing instead of the playlist
  radioError: string | null;
  buffering: boolean;      // waiting for audio: a station tuning in, or a stalled stream
  playing: boolean;
  paused: boolean;
  time: number;
  duration: number;
  libraryLoaded: boolean;
  // Remembered per browser:
  volume: number;          // 0..1
  balance: number;         // -1..1
  eq: number[];            // dB, -12..12
  preamp: number;          // dB
  eqOn: boolean;
  shuffle: boolean;
  repeat: ZecampRepeat;   // 'all' loops the playlist, 'one' the current track
  theme: ZecampTheme;
  vis: ZecampVis;
  remaining: boolean;      // time display counts down
  showEq: boolean;
  showPl: boolean;
  showRadio: boolean;       // the lower window shows radio stations instead of the playlist
  shade: boolean;          // main window rolled up to one bar
  milkdrop: boolean;       // the Milkdrop visualiser is open (not remembered)
}

export const useZecamp = create<State>()(persist((): State => ({
  tracks: [], index: -1, station: null, radioError: null, buffering: false, playing: false, paused: false, time: 0, duration: 0, libraryLoaded: false,
  volume: 0.8, balance: 0, eq: [...EQ_PRESETS.Flat], preamp: 0, eqOn: true, shuffle: false, repeat: 'off',
  theme: 'base', vis: 'spectrum', remaining: false, showEq: true, showPl: true, showRadio: false, shade: false, milkdrop: false,
}), {
  name: 'zecamp',
  // v1: repeat went from on/off to off/all/one; a saved `true` meant "loop the playlist".
  version: 1,
  migrate: (p, v) => {
    const old = p as Record<string, unknown>;
    return (v < 1 ? { ...old, repeat: old.repeat === true ? 'all' : 'off' } : old) as unknown as State;
  },
  partialize: (s) => ({
    volume: s.volume, balance: s.balance, eq: s.eq, preamp: s.preamp, eqOn: s.eqOn, shuffle: s.shuffle,
    repeat: s.repeat, theme: s.theme, vis: s.vis, remaining: s.remaining, showEq: s.showEq, showPl: s.showPl, showRadio: s.showRadio, shade: s.shade,
  }),
}));

const set = useZecamp.setState;
const get = useZecamp.getState;

// ── the audio graph ────────────────────────────────────────────────────────────
let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let pre: GainNode | null = null;
let bands: BiquadFilterNode[] = [];
let pan: StereoPannerNode | null = null;
let vol: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let sides: { l: AnalyserNode; r: AnalyserNode } | null = null;

const db = (d: number) => Math.pow(10, d / 20);

/**
 * Two elements. `audio` runs through the graph (EQ, balance, visualiser) and
 * so loads cross-origin with CORS. `plain` is for the few stations that send no
 * usable CORS header (WFMU): it plays them untouched, volume only. Only the
 * current one's events count.
 */
let plain: HTMLAudioElement | null = null;
const cur = (): HTMLAudioElement | null => (get().station?.noCors ? plain : audio);

function makeEl(cors: boolean): HTMLAudioElement {
  const a = new Audio();
  if (cors) a.crossOrigin = 'anonymous';
  a.preload = 'metadata';
  const on = (ev: string, fn: () => void) => a.addEventListener(ev, () => { if (a === cur()) fn(); });
  on('error', () => set({ buffering: false, ...(get().station && a.currentSrc ? { radioError: 'Station unavailable right now', playing: false } : {}) }));
  on('waiting', () => { if (!a.paused) set({ buffering: true }); });
  on('playing', () => set({ buffering: false }));
  on('timeupdate', () => set({ time: a.currentTime }));
  on('durationchange', () => {
    const d = a.duration;
    if (Number.isFinite(d)) {
      set({ duration: d });
      const { tracks, index } = get();
      if (tracks[index] && !tracks[index].duration) patch(tracks[index].id, { duration: d });
    }
  });
  on('ended', () => void next(true));
  on('play', () => set({ playing: true, paused: false }));
  on('pause', () => set({ playing: false }));
  return a;
}
function el(): HTMLAudioElement { return (audio ??= makeEl(true)); }
function plainEl(): HTMLAudioElement { plain ??= makeEl(false); plain.volume = get().volume; return plain; }

/** Let go of a stream entirely: a paused live stream would go on downloading. */
function release(a: HTMLAudioElement | null): void {
  if (!a || !a.getAttribute('src')) return;
  a.pause();
  a.removeAttribute('src');
  a.load();
}

/** Built on the first play: browsers only start audio from a click. */
function graph(): void {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  const a = el();
  ctx = new AudioContext();
  const src = ctx.createMediaElementSource(a);
  pre = ctx.createGain();
  bands = EQ_BANDS.map((f, i) => {
    const b = ctx!.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    b.Q.value = 1.4;
    return b;
  });
  pan = ctx.createStereoPanner();
  vol = ctx.createGain();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;
  let node: AudioNode = src.connect(pre);
  for (const b of bands) node = node.connect(b);
  node.connect(pan).connect(vol).connect(analyser).connect(ctx.destination);
  // A tap per channel, for anything that wants to know which side the sound is on.
  const split = ctx.createChannelSplitter(2);
  vol.connect(split);
  const side = (ch: number) => {
    const a = ctx!.createAnalyser();
    a.fftSize = 2048; a.smoothingTimeConstant = 0.6;
    split.connect(a, ch);
    return a;
  };
  sides = { l: side(0), r: side(1) };
  apply();
}

/** Push the remembered settings into the graph. */
function apply(): void {
  const s = get();
  if (vol) vol.gain.value = s.volume;
  if (plain) plain.volume = s.volume;
  if (pan) pan.pan.value = s.balance;
  if (pre) pre.gain.value = s.eqOn ? db(s.preamp) : 1;
  bands.forEach((b, i) => { b.gain.value = s.eqOn ? s.eq[i] ?? 0 : 0; });
}
useZecamp.subscribe((s, p) => {
  if (s.volume !== p.volume || s.balance !== p.balance || s.eq !== p.eq || s.preamp !== p.preamp || s.eqOn !== p.eqOn) apply();
});

/** The live signal, for the visualiser and (later) Pools. Null until something has played. */
export function zecampAnalyser(): AnalyserNode | null { return analyser; }
/** The audio context and the node after volume, for Milkdrop to listen to. Null until something has played. */
export function zecampAudio(): { ctx: AudioContext; node: AudioNode } | null { return ctx && analyser ? { ctx, node: analyser } : null; }
/** Left and right taps (a mono track reads the same on both). Null until something has played. */
export function zecampSides(): { l: AnalyserNode; r: AnalyserNode } | null { return sides; }
/** Where the playhead is right now, finer than the store's timeupdate ticks. */
export function zecampNow(): number { return cur()?.currentTime ?? 0; }

// ── library ────────────────────────────────────────────────────────────────────
function patch(id: string, p: Partial<Track>): void {
  set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
}

async function readHead(t: Track, file?: File): Promise<void> {
  try {
    const buf = file
      ? await file.slice(0, HEAD_BYTES).arrayBuffer()
      : await fetch(t.url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } }).then((r) => r.arrayBuffer());
    patch(t.id, parseMp3(buf, t.size));
  } catch { /* the file name will do */ }
}

let loading: Promise<void> | null = null;
/** The shipped playlist (public/music). Once per page. */
export function loadLibrary(): Promise<void> {
  loading ??= fetch('/music/manifest.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { tracks: [] }))
    .then(async (j: { tracks?: { file: string; url: string; size: number }[] }) => {
      const shipped: Track[] = (j.tracks ?? []).map((m) => ({ id: `s:${m.file}`, url: m.url, name: m.file.replace(/\.mp3$/i, ''), size: m.size }));
      set((s) => ({ tracks: [...shipped, ...s.tracks.filter((t) => t.local)], libraryLoaded: true }));
      for (const t of shipped) await readHead(t);
    })
    .catch(() => { set({ libraryLoaded: true }); });
  return loading;
}

let localSeq = 0;
/** Files from this browser: playable now, gone when the tab is. */
export function addFiles(files: FileList | File[]): void {
  const added: [Track, File][] = [...files]
    .filter((f) => /\.mp3$/i.test(f.name) || f.type === 'audio/mpeg')
    .map((f) => [{ id: `l:${++localSeq}:${f.name}`, url: URL.createObjectURL(f), name: f.name.replace(/\.mp3$/i, ''), size: f.size, local: true }, f]);
  if (!added.length) return;
  set((s) => ({ tracks: [...s.tracks, ...added.map(([t]) => t)] }));
  for (const [t, f] of added) void readHead(t, f);
}

export function removeTracks(ids: string[]): void {
  const drop = new Set(ids);
  const { tracks, index } = get();
  const current = tracks[index];
  for (const t of tracks) if (drop.has(t.id) && t.local) URL.revokeObjectURL(t.url);
  const kept = tracks.filter((t) => !drop.has(t.id));
  if (current && drop.has(current.id)) { stop(); set({ tracks: kept, index: -1 }); return; }
  set({ tracks: kept, index: current ? kept.indexOf(current) : -1 });
}

export function moveTrack(from: number, to: number): void {
  const { tracks, index } = get();
  if (from === to || from < 0 || to < 0 || from >= tracks.length || to >= tracks.length) return;
  const current = tracks[index];
  const next = [...tracks];
  const [t] = next.splice(from, 1);
  next.splice(to, 0, t!);
  set({ tracks: next, index: current ? next.indexOf(current) : -1 });
}

// ── transport ──────────────────────────────────────────────────────────────────
export async function play(i?: number): Promise<void> {
  const st = get().station;
  if (i === undefined && st) {                        // Play on the radio: back on air
    const c = cur();
    if (c?.paused && c.currentSrc) { void c.play(); return; }
    return playStation(st);
  }
  const { tracks, index } = get();
  if (!tracks.length) return;
  const at = i ?? (index < 0 ? 0 : index);
  const t = tracks[at];
  if (!t) return;
  graph();
  const a = el();
  if (at !== index || !a.src || get().station) {
    detachHls();
    release(plain);
    a.src = t.url;
    set({ index: at, station: null, radioError: null, buffering: false, time: 0, duration: t.duration ?? 0 });
  }
  try { await a.play(); } catch { set({ playing: false }); }
}

export function pause(): void {
  const a = cur();
  if (!a || !a.currentSrc) return;
  if (a.paused) { void a.play(); set({ paused: false }); } else { a.pause(); set({ paused: true }); }
}

/**
 * For an app that brings its own music: fade zecAmp out over `ms` and pause it.
 * Resolves true when something was playing (so the app knows to hand it back).
 */
export async function fadeOutPause(ms = 1200): Promise<boolean> {
  const a = cur();
  if (!a || a.paused || !a.currentSrc) return false;
  await ramp(a, 0, ms);
  a.pause(); set({ paused: true });
  apply();   // the level back where the settings have it, ready for a resume
  return true;
}
/** The other half: resume and fade back in to the set volume. */
export async function fadeInResume(ms = 1200): Promise<void> {
  const a = cur();
  if (!a || !a.paused || !a.currentSrc) return;
  const v = get().volume;
  if (vol && a === audio) vol.gain.value = 0; else a.volume = 0;
  void a.play(); set({ paused: false });
  await ramp(a, v, ms);
}
/** zecAmp's level, eased: through the graph's gain, or the element itself for a no-CORS station. */
function ramp(a: HTMLAudioElement, to: number, ms: number): Promise<void> {
  if (vol && ctx && a === audio) {
    const t = ctx.currentTime;
    vol.gain.cancelScheduledValues(t); vol.gain.setValueAtTime(vol.gain.value, t); vol.gain.linearRampToValueAtTime(to, t + ms / 1000);
    return new Promise((r) => setTimeout(r, ms));
  }
  const from = a.volume, t0 = performance.now();
  return new Promise((r) => {
    const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (to - from) * k; if (k < 1) requestAnimationFrame(step); else r(); };
    step();
  });
}

export function stop(): void {
  const a = cur();
  if (!a) return;
  if (get().station) {
    detachHls();
    release(a);
  } else {
    a.pause();
    a.currentTime = 0;
  }
  set({ playing: false, paused: false, buffering: false, time: 0 });
}

export function seek(t: number): void {
  const a = cur();
  if (a && Number.isFinite(t)) { a.currentTime = Math.max(0, t); set({ time: a.currentTime }); }
}

export async function next(auto = false): Promise<void> {
  if (get().station) return stepStation(1);
  const { tracks, index, shuffle, repeat } = get();
  if (!tracks.length) return;
  // Repeat one: a track that ended starts again. Next, pressed, still moves on.
  if (auto && repeat === 'one' && index >= 0) { await play(index); return; }
  let at: number;
  if (shuffle && tracks.length > 1) {
    do at = Math.floor(Math.random() * tracks.length); while (at === index);
  } else {
    at = index + 1;
    if (at >= tracks.length) {
      if (auto && repeat === 'off') { stop(); return; }
      at = 0;
    }
  }
  await play(at);
}

export async function prev(): Promise<void> {
  if (get().station) return stepStation(-1);
  const { tracks, index } = get();
  if (!tracks.length) return;
  if ((cur()?.currentTime ?? 0) > 3) { seek(0); return; }
  await play(index <= 0 ? tracks.length - 1 : index - 1);
}

// ── radio ──────────────────────────────────────────────────────────────────────
type HlsLike = { destroy: () => void };
let hls: HlsLike | null = null;
function detachHls(): void { hls?.destroy(); hls = null; }

/** Tune in. HLS streams go through hls.js, fetched only the first time one is tuned. */
export async function playStation(st: Station): Promise<void> {
  graph();
  detachHls();
  release(st.noCors ? audio : plain);
  const a = st.noCors ? plainEl() : el();
  set({ station: st, radioError: null, buffering: true, time: 0, duration: 0 });
  let url = st.url;
  if (st.resolve) {
    const j = await fetch(`/api/radio/${st.resolve}`).then((r) => r.json()).catch(() => ({}));
    if (!j.url) { set({ radioError: 'Station unavailable right now', playing: false, buffering: false }); return; }
    url = j.url;
  }
  if (get().station?.id !== st.id) return;           // tuned elsewhere meanwhile
  if (st.hls && !a.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: Hls } = await import('hls.js');
    if (get().station?.id !== st.id) return;
    if (!Hls.isSupported()) { set({ radioError: 'This browser cannot play this station', playing: false, buffering: false }); return; }
    const h = new Hls({ xhrSetup: (x) => { x.withCredentials = false; } });
    h.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) set({ radioError: 'Station unavailable right now', playing: false, buffering: false }); });
    h.loadSource(url);
    h.attachMedia(a);
    hls = h;
  } else {
    a.src = url;
  }
  try { await a.play(); } catch { /* the error handler says why */ }
}

/** Previous/next while on the radio: the neighbouring station in the same tab. */
async function stepStation(dir: 1 | -1): Promise<void> {
  const cur = get().station;
  if (!cur) return;
  const list = [NEWS, MUSIC].map((g) => g.flatMap((x) => x.stations)).find((l) => l.some((x) => x.id === cur.id)) ?? [];
  const i = list.findIndex((x) => x.id === cur.id);
  const st = list[(i + dir + list.length) % list.length];
  if (st) await playStation(st);
}

// ── the window ─────────────────────────────────────────────────────────────────
export const ZECAMP_APP = 'zecamp';

/** Open (or bring back) the zecAmp window. */
export function openZecamp(): void {
  const ws = useWindowStore.getState();
  const w = ws.windows.find((x) => x.type === ZECAMP_APP);
  if (w) { ws.focusWindow(w.id); return; }
  const meta = APP_META.find((m) => m.id === ZECAMP_APP)!;
  ws.openWindow({
    id: ZECAMP_APP, type: ZECAMP_APP, title: meta.title, size: meta.defaultSize, minSize: meta.minSize,
    position: calculateWindowPosition(ws.windows, meta.defaultSize, window.innerWidth, window.innerHeight),
  });
}

/**
 * Milkdrop: its own window on the desktop; over zecAmp itself on a standalone
 * page, where there is no desktop to open a window on.
 */
export function openMilkdrop(): void {
  if (window.location.pathname !== '/') { set({ milkdrop: true }); return; }
  const ws = useWindowStore.getState();
  const w = ws.windows.find((x) => x.type === 'milkdrop');
  if (w) { ws.focusWindow(w.id); return; }
  const meta = APP_META.find((m) => m.id === 'milkdrop')!;
  ws.openWindow({
    id: 'milkdrop', type: 'milkdrop', title: meta.title, size: meta.defaultSize, minSize: meta.minSize,
    position: calculateWindowPosition(ws.windows, meta.defaultSize, window.innerWidth, window.innerHeight),
  });
}

// Closing the window (x) ends the music; minimising keeps it playing on the strip.
if (typeof window !== 'undefined') {
  useWindowStore.subscribe((s, p) => {
    const had = p.windows.some((w) => w.type === ZECAMP_APP);
    if (had && !s.windows.some((w) => w.type === ZECAMP_APP)) stop();
  });
}
