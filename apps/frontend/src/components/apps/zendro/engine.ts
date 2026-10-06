/**
 * Zendrochronology: a flight down the hollow trunk of Zcash history.
 *
 * Time is distance along a gently winding tube of vector growth rings. Each
 * event is a stop: a line grows out of a target set in a branch opening, a box
 * types out its title, and MORE flies you into the branch, where every
 * section of the story waits beside its own cluster of leaves. All movement is
 * timed and eased with zero speed and acceleration at both ends; inside a
 * branch, position and gaze are functions of one number along a fixed path,
 * so going in, deeper, back or out always retraces the same line.
 *
 * Plain DOM + three.js, mounted into one element; `mountZendro` returns the
 * teardown. Colour is kept unmanaged (hex values used as-is, linear output),
 * which is what the additive linework was designed against.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { copyText } from '@/utils/clipboard';

export interface ZendroEvent {
  date: string;
  title: string;
  kind: string;
  pool: string | null;
  height: number | null;
  hash?: string;
  brief: string;
  people?: string[];
  notes?: [string, string[]][];
  links?: { label: string; url: string }[];
  /** A sourced rebuttal: its own section in the branch, and a DEBUNKED tag on the card that flies there. */
  debunk?: { verdict: string; points: string[]; links: { label: string; url: string }[] };
  /** Titles of events this one leans on; otherwise RELATED picks by kind and pool. */
  related?: string[];
}

/** What a trunk is called and where its links point; Zendro and its offshoots share everything else. */
export interface ZendroBrand {
  /** Route (/<id>) and storage prefix. */
  id: string;
  name: string; short: string; kicker: string; subject: string;
  /** The welcome's paragraph: how many events, first and last date. */
  intro: (n: number, from: string, to: string) => string;
  /** Theme for a first visit. */
  theme?: string;
}
export const ZENDRO: ZendroBrand = {
  id: 'zendro', name: 'Zendrochronology', short: 'Zendro', kicker: 'A journey through the rings of Zcash', subject: 'the Zcash history trunk',
  intro: (n, from, to) => `Dendrochronology dates the past by reading a tree's rings. This tree is Zcash. So far, ${n} moments are documented on it, from the first ideas of anonymous digital cash in ${from} to ${to}, every upgrade pinned to its block on chain. More rings are still being added.`,
};

export interface ZendroOptions {
  brand?: ZendroBrand;
  /** Open a block height or hash in the Explorer. */
  openExplorer: (query: string) => void;
  /** A music switch in the corner, beside help and theme: `toggle` flips it and returns the new state. */
  music?: { on: boolean; toggle: () => boolean };
  /** Open on this event (slug), and this branch section (slug), instead of the welcome. */
  start?: { event?: string | null; section?: string | null };
}

type Metal = readonly [string, string, string];
interface Page { h: string; html: string; slug: string }
interface Stop extends ZendroEvent {
  i: number; y: number; when: string; metal: Metal; size: number; pages: Page[]; phi: number; s: number; slug: string;
}
interface Frame { T: THREE.Vector3; Rt: THREE.Vector3; U: THREE.Vector3 }
interface Tube { len: number; pos: (u: number) => THREE.Vector3; frame: (u: number) => Frame }
interface Anchors { W: THREE.Vector3; E: THREE.Vector3; look: THREE.Vector3; rest: THREE.Vector3 }
interface Branch {
  tube: Tube; rb: number; stations: number[]; path: THREE.CatmullRomCurve3; plen: number; stopP: number[];
  psi: number[]; a: Anchors; leaves: THREE.Group[];
}

const V = THREE.Vector3, UP = new V(0, 1, 0), TAU = Math.PI * 2;
const RAW = THREE.LinearSRGBColorSpace;
const C = (hex: string) => new THREE.Color().setStyle(hex, RAW);
const fmt = (n: number) => n.toLocaleString('en-US');
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const xq = (q: string | number) => `/explorer?q=${q}`;
const blockA = (h: number) => `<a data-q="${h}" href="${xq(h)}" title="Block ${fmt(h)} in the Explorer">${fmt(h)}</a>`;
const hashA = (h: string, height: number, short = false) => `<a class="hash" data-q="${h}" href="${xq(h)}" title="${h} (block ${fmt(height)}) in the Explorer">${short ? h.slice(0, 8) + '…' + h.slice(-6) : h}</a>`;
const slugify = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
const LINK_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg>';
const dbkTag = (s: { i: number; debunk?: unknown }) => (s.debunk ? `<button class="dbk sm" type="button" data-dbk="${s.i}" title="Jump to the debunk">DEBUNKED</button>` : '');
const ul = (items: string[]) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const rng = (seed: number) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** Zero speed and zero acceleration at both ends; clamped, as float error can push it past 1. */
const smoother = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.min(1, x * x * x * (x * (x * 6 - 15) + 10)));
const approach = (v: number, to: number, rate: number, dt: number) => (v < to ? Math.min(to, v + rate * dt) : Math.max(to, v - rate * dt));
const clamp = THREE.MathUtils.clamp;

// ── metals: border sheens per section ─────────────────────────────────────────
const METAL = {
  gold: ['#9a6a0c', '#f4b728', '#ffe9a6'],
  verdigris: ['#14705a', '#3fcfa9', '#b6ffe8'],
  copper: ['#6e3418', '#c56b3e', '#f2b088'],
  bronze: ['#5e4018', '#a8773a', '#e8c48c'],
  amethyst: ['#3c2478', '#9966ff', '#dccbff'],
  pewter: ['#46515c', '#8899aa', '#e0e8f0'],
  rust: ['#5a1c10', '#c0452a', '#ffab90'],
} as const satisfies Record<string, Metal>;
type MetalName = keyof typeof METAL;
const POOL_METAL: Record<string, MetalName> = { sapling: 'gold', orchard: 'verdigris', ironwood: 'copper', sprout: 'amethyst', transparent: 'pewter' };
const KIND_METAL: Record<string, MetalName> = { RESEARCH: 'bronze', SECURITY: 'rust', GOVERNANCE: 'bronze', INDUSTRY: 'pewter', WALLET: 'gold', ORG: 'gold', EVENT: 'gold', MILESTONE: 'gold', 'NETWORK UPGRADE': 'gold',
  // Zendrospiracies: the evidence status, so a branch's colour says how much holds up
  'UNSUPPORTED / FALSE': 'rust', 'UNSUPPORTED SPECULATION': 'rust', 'UNSUPPORTED / SPECULATIVE': 'rust', 'DISPUTED INTERPRETATION': 'amethyst',
  'DOCUMENTED BASIS / SPECULATIVE CONCLUSION': 'bronze', 'UNRESOLVED TECHNICAL UNCERTAINTY': 'verdigris', 'DOCUMENTED BUG / NO EVIDENCE OF EXPLOITATION': 'verdigris',
  'DOCUMENTED CONTACT / OVERSTATED CLAIMS': 'copper', 'MARKET ALLEGATION': 'copper', 'GOVERNANCE ALLEGATION': 'pewter' };
const metalVars = (m: Metal) => `--m0:${m[0]};--m1:${m[1]};--m2:${m[2]}`;
/** Bigger moments grow bigger dendrites. */
const SIZE: Record<string, number> = { 'NETWORK UPGRADE': 1.45, MILESTONE: 1.45, SECURITY: 1.15, RESEARCH: 1.0, ORG: 1.0, GOVERNANCE: 0.85, INDUSTRY: 0.85, EVENT: 0.85, WALLET: 0.85, 'UNRESOLVED TECHNICAL UNCERTAINTY': 1.3 };

// ── themes: the trunk's linework and the interface; section colours never change ──
interface Theme {
  id: string; name: string;
  /** Trunk ring colour at distance s along the trunk. */
  ring: (s: number) => THREE.Color; year: (s: number) => THREE.Color; grain: (s: number) => THREE.Color; label: string;
  /** Interface: text, bright text, dim text, the r,g,b of the text colour, links, glass, the UI sheen. */
  css: Record<string, string>;
}
const fixed = (hex: string) => { const c = C(hex); return () => c; };
const blend = (stops: string[], period: number, lift = 0) => {
  const cs = stops.map(C), white = new THREE.Color(1, 1, 1);
  return (s: number) => {
    const x = ((s / period) % 1 + 1) % 1 * cs.length, i = Math.floor(x), f = x - i;
    const out = cs[i].clone().lerp(cs[(i + 1) % cs.length], f * f * (3 - 2 * f));
    return lift ? out.lerp(white, lift) : out;
  };
};
const ui = (text: string, hi: string, dim: string, rgb: string, link: string, glass: string, m0: string, m1: string, m2: string, dot: [string, string, string], scan: string) =>
  ({ '--gold': text, '--gold-hi': hi, '--gold-dim': dim, '--g': rgb, '--link': link, '--glass': glass, '--u0': m0, '--u1': m1, '--u2': m2, '--dot-a': dot[0], '--dot-b': dot[1], '--dot-c': dot[2], '--scan': scan });
const PRISM = ['#f4b728', '#e8a08a', '#c56b3e', '#ff8fb1', '#9966ff', '#3fcfa9', '#8fb4d9', '#c99a5b'];
const THEMES: Theme[] = [
  { id: 'gold', name: 'Gold', ring: fixed('#f4b728'), year: fixed('#ffd27a'), grain: fixed('#a0743a'), label: '#ffd27a',
    css: ui('#f4b728', '#ffe2a0', '#b88a2a', '244,183,40', '#6fe3c4', 'rgba(12,9,3,.62)', '#9a6a0c', '#f4b728', '#ffe9a6', ['#f4b728', '#ffe2a0', '#9a6a0c'], '.18') },
  { id: 'crt', name: 'Phosphor', ring: fixed('#2ee88a'), year: fixed('#b8ffd8'), grain: fixed('#127a46'), label: '#9dffc9',
    css: ui('#3dff9a', '#d2ffe6', '#1f9e5e', '61,255,154', '#9ff3ff', 'rgba(0,20,9,.68)', '#0b5c34', '#2ee88a', '#c8ffe0', ['#2ee88a', '#d2ffe6', '#0b5c34'], '.34') },
  { id: 'patina', name: 'Copper & verdigris', ring: blend(['#c56b3e', '#3fcfa9', '#a8773a', '#2a9d8f'], 160), year: fixed('#f2b088'), grain: fixed('#1e8f73'), label: '#b6ffe8',
    css: ui('#e9a170', '#ffd9bd', '#9a5a35', '233,161,112', '#6fe3c4', 'rgba(9,13,11,.64)', '#6e3418', '#3fcfa9', '#f2b088', ['#c56b3e', '#3fcfa9', '#f2b088'], '.18') },
  { id: 'prism', name: 'Prism', ring: blend(PRISM, 210), year: blend(PRISM, 210, 0.45), grain: blend(['#d97a9a', '#8a4a63', '#ff9fb3', '#7a5ac8'], 300), label: '#ffd6e0',
    css: ui('#f3c9a8', '#fff1e6', '#b98a86', '243,201,168', '#b6ffe8', 'rgba(14,9,14,.62)', '#7a3c5a', '#e8a08a', '#dccbff', ['#e8a08a', '#9966ff', '#3fcfa9'], '.16') },
];
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: it just won't persist */ } } };

// ── time ──────────────────────────────────────────────────────────────────────
const YEAR_MS = 365.25 * 864e5;
const yearOf = (d: string) => { const p = d.split('-').map(Number); const t = Date.UTC(p[0], (p[1] || 7) - 1, p[2] || (p[1] ? 15 : 1)); return p[0] + (t - Date.UTC(p[0], 0, 1)) / YEAR_MS; };
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const whenOf = (d: string) => { const p = d.split('-'); return p.length === 3 ? `${+p[2]} ${MON[+p[1] - 1]} ${p[0]}` : p.length === 2 ? `${MON[+p[1] - 1]} ${p[0]}` : p[0]; };
/** Height from time, between real activation anchors (read from the ZEC-OS node). */
const H_ANCH = ([['2016-10-28', 0], ['2018-06-26', 347500], ['2018-10-29', 419200], ['2019-12-11', 653600], ['2020-07-16', 903000], ['2020-11-18', 1046400], ['2022-05-31', 1687104], ['2024-11-23', 2726400], ['2025-11-24', 3146400], ['2026-06-03', 3364600], ['2026-07-28', 3428143]] as const).map(([d, h]) => [yearOf(d), h] as const);
function heightAtY(y: number): number | null {
  if (y < H_ANCH[0][0]) return null;
  for (let i = 1; i < H_ANCH.length; i++) if (y <= H_ANCH[i][0]) { const [a, ha] = H_ANCH[i - 1], [b, hb] = H_ANCH[i]; return Math.round(ha + (hb - ha) * (y - a) / (b - a)); }
  return null;
}
const ERAS: [number, string, MetalName][] = [[yearOf('2016-10-28'), 'ROOTS', 'bronze'], [yearOf('2018-10-29'), 'SPROUT', 'amethyst'], [yearOf('2022-05-31'), 'SAPLING', 'gold'], [yearOf('2026-07-28'), 'ORCHARD', 'verdigris'], [1e9, 'IRONWOOD', 'copper']];
const eraOf = (y: number) => ERAS.find((e) => y < e[0]) as [number, string, MetalName];

// ── the trunk ─────────────────────────────────────────────────────────────────
const R = 6, GAP = 15, PER_YEAR = 18, CAP = 1.3, CAM_BACK = 10, HOLE = 2.9;
const P = (s: number) => new V(Math.sin(s * 0.011) * 7 + Math.sin(s * 0.027) * 2.2, Math.cos(s * 0.008) * 4 + Math.sin(s * 0.019) * 1.2, -s);
function frameAt(s: number): Frame {
  const T = P(s + 0.5).sub(P(s - 0.5)).normalize();
  const Rt = new V().crossVectors(T, UP).normalize();
  return { T, Rt, U: new V().crossVectors(Rt, T) };
}
const wall = (s: number, th: number, r = R) => { const f = frameAt(s); return P(s).addScaledVector(f.Rt, Math.cos(th) * r).addScaledVector(f.U, Math.sin(th) * r); };
function curveTube(curve: THREE.Curve<THREE.Vector3>): Tube {
  const len = curve.getLength(), cl = (u: number) => clamp(u / len, 0, 1);
  return {
    len, pos: (u) => curve.getPointAt(cl(u)),
    frame: (u) => { const T = curve.getTangentAt(cl(u)).normalize(); const ref = Math.abs(T.dot(UP)) > 0.92 ? new V(1, 0, 0) : UP; const Rt = new V().crossVectors(T, ref).normalize(); return { T, Rt, U: new V().crossVectors(Rt, T) }; },
  };
}
/** A branch's radius: a gentle taper, closing to a rounded tip over its last TIP units. */
const TIP = 5;
const taperAt = (b: Branch, u: number) => b.rb * (1 - u / b.tube.len * 0.3) * Math.sqrt(clamp((b.tube.len - u) / TIP, 0, 1));
const onTube = (tube: Tube, u: number, th: number, r: number) => { const f = tube.frame(u); return tube.pos(u).addScaledVector(f.Rt, Math.cos(th) * r).addScaledVector(f.U, Math.sin(th) * r); };

// ── vector linework ───────────────────────────────────────────────────────────
class Lines {
  p: number[] = []; c: number[] = [];
  seg(a: THREE.Vector3, b: THREE.Vector3, col: THREE.Color, k = 1) { this.p.push(a.x, a.y, a.z, b.x, b.y, b.z); const r = col.r * k, g = col.g * k, bl = col.b * k; this.c.push(r, g, bl, r, g, bl); }
  poly(pts: THREE.Vector3[], col: THREE.Color, k = 1, closed = false, skip?: (i: number) => boolean) {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const j = (i + 1) % pts.length; if (skip && (skip(i) || skip(j))) continue; this.seg(pts[i], pts[j], col, k); }
  }
  build(width: number, mats: LineMaterial[]) {
    const g = new LineSegmentsGeometry(); g.setPositions(this.p); g.setColors(this.c);
    const m = new LineMaterial({ linewidth: width, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.fog = true; mats.push(m);
    const o = new LineSegments2(g, m); o.frustumCulled = false; return o;
  }
}
type Role = 'ring' | 'year' | 'grain';
/** Trunk linework: each segment keeps its role, brightness and place, so a theme can recolour it. */
class TrunkLines extends Lines {
  meta: [Role, number, number][] = [];
  seg(a: THREE.Vector3, b: THREE.Vector3, col: THREE.Color, k = 1) { super.seg(a, b, col, k); this.meta.push([this.role, k, (-a.z - b.z) / 2]); }
  role: Role = 'ring';
  colours(t: Theme) {
    const out = new Float32Array(this.meta.length * 6);
    this.meta.forEach(([role, k, s], i) => { const c = t[role](s); out.set([c.r * k, c.g * k, c.b * k, c.r * k, c.g * k, c.b * k], i * 6); });
    return out;
  }
}
function ring(L: Lines, tube: Tube, u: number, r: number, col: THREE.Color, k: number, n = 128, wob = 0, seed = 0, skip?: (u: number, th: number) => boolean) {
  const pts: THREE.Vector3[] = [], th: number[] = [], f = tube.frame(u), c = tube.pos(u);
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, rr = r * (1 + wob * (0.6 * Math.sin(3 * a + seed) + 0.4 * Math.sin(7 * a - seed * 1.7)));
    pts.push(c.clone().addScaledVector(f.Rt, Math.cos(a) * rr).addScaledVector(f.U, Math.sin(a) * rr)); th.push(a);
  }
  L.poly(pts, col, k, true, skip ? (i) => skip(u, th[i]) : undefined);
}
function grain(L: Lines, tube: Tube, col: THREE.Color, k: number, step: number, thAt: (u: number) => number, rAt: (u: number) => number, kAt?: (u: number) => number, skip?: (u: number, th: number) => boolean) {
  let prev: { p: THREE.Vector3; u: number; th: number } | null = null;
  for (let i = 0, n = Math.ceil(tube.len / step); i <= n; i++) {
    const u = Math.min(i * step, tube.len), th = thAt(u), p = onTube(tube, u, th, rAt(u));
    if (prev && !(skip && (skip(prev.u, prev.th) || skip(u, th)))) L.seg(prev.p, p, col, kAt ? kAt(u) * k : k);
    prev = { p, u, th };
  }
}
function labelTex(text: string, color: string, font: string) {
  const cv = document.createElement('canvas'), x = cv.getContext('2d') as CanvasRenderingContext2D;
  x.font = font; const w = Math.ceil(x.measureText(text).width) + 24;
  cv.width = w; cv.height = 64; x.font = font; x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 12, 34);
  return { tex: new THREE.CanvasTexture(cv), w };
}
function label(text: string, color: string, h: number, font: string) {
  const { tex, w } = labelTex(text, color, font);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
  sp.scale.set(h * w / 64, h, 1); return sp;
}

// ── markup ────────────────────────────────────────────────────────────────────
const LIST_ICON = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6.5 4h9.5M6.5 9h9.5M6.5 14h9.5"/><path d="M2 3.2l1.2.8-1.2.8M2 8.2l1.2.8-1.2.8M2 13.2l1.2.8-1.2.8" stroke-width="1.1"/></svg>';
const SEARCH_ICON = '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7.5" cy="7.5" r="5"/><path d="M11.2 11.2l5 5" stroke-width="1.8"/><path d="M5.2 6.2a2.6 2.6 0 0 1 2.2-1.6" stroke-width="1.1" opacity=".7"/></svg>';
const NOTE_ICON = '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 13.5V4l7-1.5v9"/><circle cx="5.2" cy="13.6" r="1.9"/><circle cx="12.2" cy="11.6" r="1.9"/><path class="strike" d="M2.5 2.5l13 13" stroke-width="1.6"/></svg>';
const X_ICON = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2l8 8M10 2l-8 8"/></svg>';
const HELP_ICON = '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6.4 6.6a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1-1.3 2v.6"/><circle cx="9" cy="14.2" r=".9" fill="currentColor" stroke="none"/></svg>';
const OFFICIAL: [string, string][] = [['z.cash', 'https://z.cash'], ['Forum', 'https://forum.zcashcommunity.com'], ['ZecHub', 'https://zechub.wiki'], ['Zcash Foundation', 'https://zfnd.org'], ['Electric Coin Co.', 'https://electriccoin.co'], ['ZIPs', 'https://zips.z.cash']];

// ── the world ─────────────────────────────────────────────────────────────────
function prepare(events: ZendroEvent[]) {
  const STOPS = events.map((e) => {
    const metal = METAL[(e.pool && POOL_METAL[e.pool]) || KIND_METAL[e.kind] || 'gold'];
    return { ...e, i: 0, y: yearOf(e.date), when: whenOf(e.date), metal, size: SIZE[e.kind] || 0.9, pages: [] as Page[], phi: 0, s: 0 } as Stop;
  }).sort((a, b) => a.y - b.y);
  // Distance along the trunk: a floor per gap plus a capped share of the real time between stops,
  // so dense months stay readable and empty decades compress (the rings bunch up there).
  let acc = 14;
  STOPS.forEach((st, i) => {
    st.i = i; st.phi = (i * 2.39996 + 0.8) % TAU;   // golden angle: anywhere round the trunk
    if (i) acc += GAP + PER_YEAR * Math.min(CAP, st.y - STOPS[i - 1].y);
    st.s = acc;
  });
  const LEN = acc + 34;
  const ANCH = [[STOPS[0].y - 0.6, 0], ...STOPS.map((st) => [st.y, st.s]), [STOPS[STOPS.length - 1].y + 0.9, LEN]];
  const interp = (x: number, i0: number, i1: number) => { for (let i = 1; i < ANCH.length; i++) if (x <= ANCH[i][i0]) { const a = ANCH[i - 1], b = ANCH[i]; return a[i1] + (b[i1] - a[i1]) * (x - a[i0]) / (b[i0] - a[i0] || 1); } return ANCH[ANCH.length - 1][i1]; };
  const sOfY = (y: number) => interp(y, 0, 1), yOfS = (s: number) => interp(s, 1, 0);

  // The first card in a branch: where this sits in the story, rather than the brief again.
  const contextOf = (st: Stop) => {
    const G = yearOf('2016-10-28'), dy = st.y - G, ady = Math.abs(dy);
    const span = ady * 365.25 < 45 ? `${Math.round(ady * 365.25)} days` : ady < 2 ? `${Math.round(ady * 12)} months` : `${ady.toFixed(1)} years`;
    const rel = ady * 365.25 < 1 ? 'Launch day' : `${span} ${dy > 0 ? 'after' : 'before'} genesis`;
    const era = eraOf(st.y);
    const zips = [...new Set(((st.brief.match(/ZIPs?[^.;]*/g) || []).join(' ').match(/\b\d{3,4}\b/g) || []))];
    const jump = (o: Stop) => `<button class="jump" type="button" data-go="${o.i}">${esc(o.title)}</button> <span class="dim">${o.when}</span>`;
    const prev = STOPS[st.i - 1], next = STOPS[st.i + 1];
    const related = st.related ? STOPS.filter((o) => st.related!.includes(o.title)) : STOPS.filter((o) => o !== st && (o.kind === st.kind || (st.pool && o.pool === st.pool))).sort((a, b) => Math.abs(a.y - st.y) - Math.abs(b.y - st.y)).slice(0, 4).sort((a, b) => a.y - b.y);
    const fact = (k: string, v: string) => `<div><span>${k}</span>${v}</div>`;
    const est = heightAtY(st.y);
    return `<div class="facts">${fact('ERA', `<b style="color:${METAL[era[2]][2]}">${era[1]}</b>`)}${fact('KIND', esc(st.kind))}${fact('WHEN', rel)}${fact('ON THE TRUNK', `event ${st.i + 1} of ${STOPS.length}`)}${st.height != null ? fact('BLOCK', blockA(st.height)) : fact('BLOCK', est == null ? 'before the chain' : `≈${fmt(est)}`)}${fact('SOURCES', `${(st.links || []).length} linked`)}</div>`
      + (st.hash && st.height != null ? `<div class="h">BLOCK HASH</div><p>${hashA(st.hash, st.height)}</p>` : '')
      + (zips.length ? `<div class="h">ZIPS</div><p>${zips.map((z) => `<a class="hash" href="https://zips.z.cash/zip-${z.padStart(4, '0')}" target="_blank" rel="noopener">ZIP ${z}</a>`).join(' · ')}</p>` : '')
      + `<div class="h">BEFORE · AFTER</div><ul>${prev ? `<li>◂ ${jump(prev)}</li>` : ''}${next ? `<li>▸ ${jump(next)}</li>` : ''}</ul>`
      + (related.length ? `<div class="h">RELATED</div><ul>${related.map((o) => `<li>${jump(o)}</li>`).join('')}</ul>` : '');
  };
  // What a branch holds, one section per station. Long lists split, so a branch can run deep.
  for (const st of STOPS) {
    const pages: Omit<Page, 'slug'>[] = [{ h: 'CONTEXT', html: contextOf(st) }];
    for (const [h, items] of st.notes || []) for (let i = 0; i < items.length; i += 4) pages.push({ h: h + (items.length > 4 ? ` ${i / 4 + 1}` : ''), html: ul(items.slice(i, i + 4)) });
    if (st.debunk) pages.push({ h: 'DEBUNKED', html: `<p class="verdict">${esc(st.debunk.verdict)}</p>${ul(st.debunk.points)}<div class="h">DEBUNK SOURCES</div><ul>${st.debunk.links.map((l) => `<li><a class="hash" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join('')}</ul>` });
    const ppl = st.people || [];
    for (let i = 0; i < ppl.length; i += 5) pages.push({ h: 'PEOPLE' + (ppl.length > 5 ? ` ${i / 5 + 1}` : ''), html: ul(ppl.slice(i, i + 5)) });
    if (st.links && st.links.length) pages.push({ h: 'SOURCES', html: `<ul>${st.links.map((l) => `<li><a class="hash" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join('')}</ul>` });
    st.pages = pages.map((p) => ({ ...p, slug: slugify(p.h) }));
  }
  // A readable slug per event for share links; a clash takes the year, then a number.
  const taken = new Set<string>();
  for (const st of STOPS) {
    let slug = slugify(st.title);
    if (taken.has(slug)) slug = `${slug}-${st.date.slice(0, 4)}`;
    for (let n = 2; taken.has(slug); n++) slug = `${slugify(st.title)}-${n}`;
    taken.add(slug); st.slug = slug;
  }
  return { STOPS, LEN, sOfY, yOfS };
}

export function mountZendro(el: HTMLElement, events: ZendroEvent[], opts: ZendroOptions): () => void {
  const brand = opts.brand ?? ZENDRO, THEME_KEY = `${brand.id}:theme`, HELP_KEY = `${brand.id}:help-seen`;
  const { STOPS, LEN, sOfY, yOfS } = prepare(events);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const monoFont = getComputedStyle(el).getPropertyValue('--zd-mono').trim() || 'monospace';

  function inHole(s: number, th: number) {
    for (const st of STOPS) {
      const ds = s - (st.s + HOLE);
      if (ds > 5 || ds < -5) continue;
      const dth = Math.atan2(Math.sin(th - st.phi), Math.cos(th - st.phi));
      if ((ds / (3.2 * st.size)) ** 2 + ((dth * R) / (2.5 * st.size)) ** 2 < 1) return true;
    }
    return false;
  }
  // The target floats in the opening; the line runs from it toward the trunk's middle, and the
  // stop's gaze settles between straight ahead and the line's end. Shared by trunk and branch.
  function anchorsOf(st: Stop): Anchors {
    const W = wall(st.s + HOLE, st.phi, R * 0.97);
    const E = P(st.s - 1.5).lerp(W, 0.45);
    return { W, E, look: P(st.s - CAM_BACK + 9).lerp(E, 0.36), rest: P(st.s - CAM_BACK).addScaledVector(frameAt(st.s - CAM_BACK).U, 0.25) };
  }
  function branchFor(st: Stop): Branch {
    const n = st.pages.length, f = frameAt(st.s + 2);
    const D = f.Rt.clone().multiplyScalar(Math.cos(st.phi)).addScaledVector(f.U, Math.sin(st.phi));
    const side = new V().crossVectors(D, f.T).normalize(), sg = st.i % 2 ? 1 : -1;
    const L = 18 + 11 * n, pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 8; j++) {
      const q = j / 8;
      pts.push(P(st.s + 2.6 + L * 0.36 * Math.pow(q, 1.3)).addScaledVector(D, R * 0.8 + L * 0.74 * Math.pow(q, 0.85)).addScaledVector(side, sg * Math.sin(q * Math.PI) * L * 0.08));
    }
    const tube = curveTube(new THREE.CatmullRomCurve3(pts));
    const stations = st.pages.map((_, k) => tube.len * (n === 1 ? 0.45 : 0.26 + 0.62 * k / (n - 1)));
    const camAt = (k: number) => Math.max(1, stations[k] - 4.8);
    // The camera's whole route in the branch, from the trunk stop through the opening and on past
    // every section. Where you are on it is one number.
    const a = anchorsOf(st), route = [a.rest, P(st.s - 2).addScaledVector(D, 1.4), tube.pos(0.4)];
    for (let u = 3.5; u < tube.len - 2; u += 3.5) route.push(tube.pos(u));
    const path = new THREE.CatmullRomCurve3(route); path.arcLengthDivisions = 800;
    const plen = path.getLength(), samples = path.getSpacedPoints(800);
    const pOf = (pt: THREE.Vector3) => { let bi = 0, bd = Infinity; samples.forEach((q, i) => { const d = q.distanceToSquared(pt); if (d < bd) { bd = d; bi = i; } }); return bi / 800 * plen; };
    const r = rng(st.i * 7919 + 13);
    return { tube, rb: 2.4 * st.size, stations, path, plen, stopP: stations.map((_, k) => pOf(tube.pos(camAt(k)))), psi: stations.map(() => r() * TAU), a, leaves: [] };
  }
  // A cluster of vector leaves growing out through the branch wall at one station.
  function leafCluster(st: Stop, br: Branch, k: number, mats: LineMaterial[]) {
    const L = new Lines(), r = rng(st.i * 977 + k * 131 + 7);
    const m1 = C(st.metal[1]), m2 = C(st.metal[2]);
    const u0 = br.stations[k], psi = br.psi[k], taper = (u: number) => taperAt(br, u);
    const center = onTube(br.tube, u0, psi, taper(u0) * 1.3);
    const n = 8 + Math.floor(r() * 5);
    for (let j = 0; j < n; j++) {
      const u = clamp(u0 + (r() - 0.5) * 4.5, 0.5, br.tube.len - 0.5), th = psi + (r() - 0.5) * 1.2;
      const f = br.tube.frame(u), base = onTube(br.tube, u, th, taper(u));
      const nrm = base.clone().sub(br.tube.pos(u)).normalize();
      const dir = nrm.clone().addScaledVector(f.T, (r() - 0.35) * 1.3).normalize();
      const p0 = base.clone().addScaledVector(dir, 0.5 + r() * 1.2);
      let w = new V().crossVectors(dir, nrm); if (w.lengthSq() < 1e-4) w = f.Rt.clone(); w.normalize().applyAxisAngle(dir, (r() - 0.5) * 1.4);
      const nl = new V().crossVectors(dir, w).normalize();
      const lf = (1.1 + r() * 1.2) * Math.sqrt(st.size), wf = lf * (0.24 + r() * 0.14);
      const pt = (a: number, sd: number) => p0.clone().addScaledVector(dir, a * lf).addScaledVector(w, sd * wf * Math.pow(Math.sin(Math.PI * Math.min(1, a)), 0.85) * (1 - 0.3 * a)).addScaledVector(nl, 0.12 * lf * Math.sin(Math.PI * Math.min(1, a))).sub(center);
      L.seg(base.clone().sub(center), p0.clone().sub(center), m1, 0.75);
      const left: THREE.Vector3[] = [], right: THREE.Vector3[] = [], mid: THREE.Vector3[] = [];
      for (let i = 0; i <= 14; i++) { const a = i / 14; left.push(pt(a, 1)); right.push(pt(a, -1)); mid.push(pt(a, 0)); }
      L.poly(left, m2, 0.95); L.poly(right, m2, 0.95); L.poly(mid, m1, 0.6);
      for (const a of [0.24, 0.41, 0.58, 0.74]) { L.seg(pt(a, 0), pt(a + 0.13, 0.86), m1, 0.42); L.seg(pt(a, 0), pt(a + 0.13, -0.86), m1, 0.42); }
    }
    const obj = L.build(1.4, mats); obj.material.opacity = 0.45;
    const g = new THREE.Group(); g.position.copy(center); g.add(obj); g.userData.mat = obj.material; return g;
  }
  function buildWorld(scene: THREE.Scene, mats: LineMaterial[], branches: Map<Stop, Branch>) {
    const W1 = new THREE.Color(1, 1, 1);
    const thin = new TrunkLines(), years = new TrunkLines(), streak = new TrunkLines(), bold = new Lines(), twig = new Lines();
    streak.role = 'grain'; years.role = 'year';
    const trunk: Tube = { len: LEN, pos: P, frame: frameAt };
    const y0 = Math.ceil(STOPS[0].y - 0.6), y1 = Math.floor(STOPS[STOPS.length - 1].y + 0.9);
    const yearS: [number, number][] = []; for (let y = y0; y <= y1; y++) yearS.push([y, sOfY(y)]);
    let n = 0;
    for (let s = 1; s < LEN; s += 1.15, n++) ring(thin, trunk, s, R * (1 + 0.02 * Math.sin(s * 0.37)), W1, n % 4 === 0 ? 0.42 : 0.2, 128, 0.028, s * 0.7, inHole);
    // a doubled bright ring at each new year; where time is compressed they crowd together
    // (dimmed where they crowd, or the compressed decades stack into one white glare)
    yearS.forEach(([, s], i) => {
      const gap = Math.min(i ? s - yearS[i - 1][1] : 99, i < yearS.length - 1 ? yearS[i + 1][1] - s : 99), k = Math.min(1, gap / 9);
      const r = R * (1 + 0.02 * Math.sin(s * 0.37));
      ring(years, trunk, s, r, W1, 0.85 * k, 160, 0.022, s, inHole);
      if (k > 0.5) ring(thin, trunk, s + 0.22, r * 0.992, W1, 0.5 * k, 160, 0.022, s + 1, inHole);
    });
    for (let i = 0; i < 64; i++) { const th0 = i / 64 * TAU; grain(streak, trunk, W1, i % 4 === 0 ? 0.42 : 0.2, 1.4, (u) => th0 + 0.05 * Math.sin(u * 0.045 + i * 1.3), () => R * 1.01, undefined, inHole); }
    for (const st of STOPS) {
      const m1 = C(st.metal[1]), m2 = C(st.metal[2]), z = st.size;
      const pts: THREE.Vector3[] = [], pts2: THREE.Vector3[] = [];
      for (let i = 0; i < 96; i++) { const a = i / 96 * TAU; pts.push(wall(st.s + HOLE + Math.cos(a) * 3.2 * z, st.phi + Math.sin(a) * 2.5 * z / R)); pts2.push(wall(st.s + HOLE + Math.cos(a) * 3.45 * z, st.phi + Math.sin(a) * 2.75 * z / R, R * 1.002)); }
      bold.poly(pts, m2, 0.9, true); bold.poly(pts2, m1, 0.4, true);
      const b = branches.get(st) as Branch, taper = (u: number) => taperAt(b, u), fade = (u: number) => 1 - u / b.tube.len * 0.55;
      for (let u = 0.5; u < b.tube.len - 0.1; u += 1.3) ring(twig, b.tube, u, taper(u), m1, 0.34 * fade(u), 72, 0.03, u);
      // the tip: a small bright bud where the branch closes
      for (const [d, r, k] of [[0.35, 0.16, 0.9], [0.8, 0.3, 0.5]]) ring(bold, b.tube, b.tube.len - d, r * z, m2, k, 32);
      for (let i = 0; i < 16; i++) grain(twig, b.tube, m1, 0.2, 1.1, () => i / 16 * TAU, (u) => taper(u) * 1.01, fade);
      b.leaves = b.stations.map((_, k) => { const g = leafCluster(st, b, k, mats); scene.add(g); return g; });
      // the target, set in the branch opening
      const s0 = st.s + HOLE, f = frameAt(s0), c0 = b.a.W;
      const nrm = c0.clone().sub(P(s0)).normalize(), t1 = f.T, t2 = new V().crossVectors(nrm, t1);
      for (const [rad, k] of [[0.18, 1], [0.38, 0.8], [0.62, 0.45]]) {
        const q: THREE.Vector3[] = []; for (let i = 0; i < 48; i++) { const a = i / 48 * TAU; q.push(c0.clone().addScaledVector(t1, Math.cos(a) * rad * z).addScaledVector(t2, Math.sin(a) * rad * z)); }
        bold.poly(q, m2, k, true);
      }
    }
    const rings = thin.build(1.2, mats), yrs = years.build(2.0, mats), grains = streak.build(1.2, mats), marks = bold.build(2.0, mats), twigs = twig.build(1.2, mats);
    scene.add(rings, yrs, grains, marks, twigs);
    const fading: THREE.Material[] = [rings.material, yrs.material, marks.material, twigs.material];
    const labels: { sp: THREE.Sprite; text: string }[] = [];
    let lastLabel = -1e9;
    for (const [y, s] of yearS) {
      if (s - lastLabel < 5) continue;
      lastLabel = s; const lb = label(String(y), '#ffd27a', 0.6, `500 46px ${monoFont}`); lb.position.copy(wall(s + 0.4, -Math.PI / 2, R * 0.9)); scene.add(lb); fading.push(lb.material); labels.push({ sp: lb, text: String(y) });
    }
    // A theme recolours the trunk in place: new colour buffers, redrawn year labels.
    const recolour = (t: Theme) => {
      for (const [L, obj] of [[thin, rings], [years, yrs], [streak, grains]] as const) obj.geometry.setColors(L.colours(t));
      for (const { sp, text } of labels) { const old = sp.material.map; sp.material.map = labelTex(text, t.label, `500 46px ${monoFont}`).tex; old?.dispose(); sp.material.needsUpdate = true; }
    };
    // what fades as you speed up; the lengthwise grain stays and streaks
    return { fading, recolour };
  }

  // ── markup ──
  const yrMarks: [number, number][] = [];
  { let last = -1; for (const y of [Math.round(STOPS[0].y), 2013, 2016, 2019, 2022, 2026]) { const f = sOfY(y) / LEN; if (f - last > 0.09) { yrMarks.push([y, f]); last = f; } } }
  const gv = '--m0:var(--u0);--m1:var(--u1);--m2:var(--u2)';
  el.innerHTML = `
    <canvas aria-label="${esc(brand.name)}: ${esc(brand.subject)}"></canvas>
    <div class="zd-vignette"></div>
    <div class="zd-hud tl glass sheen" style="${gv}"><div class="lbl"><b>${esc(brand.short.toUpperCase())}</b> // <span data-k="where">TRUNK</span></div><div class="date" data-k="date">-</div><div class="blk" data-k="blk">-</div><div data-k="era">-</div></div>
    <div class="zd-hud tr">
      <div class="slider glass sheen" style="${gv}" role="slider" tabindex="0" aria-label="Timeline: click or drag to travel">
        <div class="track"><div class="rail"></div><div class="fill"></div>${STOPS.map((s, i) => `<div class="tick${s.size > 1.2 ? ' big' : ''}" data-i="${i}" title="${esc(s.when + ' · ' + s.title)}" style="left:${(s.s / LEN * 100).toFixed(2)}%;background:${s.metal[1]};color:${s.metal[1]}"></div>`).join('')}<div class="cur"></div></div>
        <div class="yrs">${yrMarks.map(([y, f]) => `<span style="left:${(f * 100).toFixed(2)}%">${y}</span>`).join('')}</div>
      </div>
      <button class="srchbtn glass sheen" style="${gv}" type="button" aria-expanded="false" aria-label="Search events" title="Search events">${SEARCH_ICON}</button>
      <button class="listbtn glass sheen" style="${gv}" type="button" aria-expanded="false" aria-label="All events" title="All events">${LIST_ICON}</button>
    </div>
    <div class="list glass sheen multi" role="dialog" aria-label="All events">
      <div class="lhead"><span>ALL EVENTS · ${STOPS.length}</span><button class="x" type="button" aria-label="Close list">${X_ICON}</button></div>
      <div class="scroll">${STOPS.map((s, i) => `<div class="row" data-i="${i}"><span class="when">${s.when}</span><span class="gc"><button class="go" type="button" data-i="${i}"><i style="--c:${s.metal[1]}"></i>${esc(s.title)}</button>${dbkTag(s)}</span><span class="n">${s.height != null ? blockA(s.height) : ''}</span><span class="h">${s.hash && s.height != null ? hashA(s.hash, s.height, true) : ''}</span></div>`).join('')}
        <div class="official">${OFFICIAL.map(([l, u]) => `<a href="${u}" target="_blank" rel="noopener">${l}</a>`).join('')}</div></div>
    </div>
    <div class="search glass sheen multi2" role="dialog" aria-label="Search events">
      <div class="lhead">${SEARCH_ICON}<input class="q" type="search" autocomplete="off" spellcheck="false" placeholder="SEARCH EVENTS, PEOPLE, TERMS" aria-label="Search events"><button class="x" type="button" aria-label="Close search">${X_ICON}</button></div>
      <div class="scroll results"><div class="note">TYPE <b>3 LETTERS</b> TO SEARCH ${STOPS.length} EVENTS</div></div>
    </div>
    <div class="box glass sheen"><div class="inner"><div class="hdr"><button class="share" type="button" data-share="event" data-tip="Share this event" aria-label="Copy a link to this event">${LINK_ICON}</button><div class="d"></div><div class="t"></div><button class="dbk" type="button" hidden title="Jump to the debunk">DEBUNKED ▸</button></div><div class="bd"><div class="txt"><span class="ghost"></span><span class="typed"></span></div><div class="oc"></div><button class="btn glow more" type="button">MORE ▸ ENTER BRANCH</button></div></div></div>
    <span class="tmeasure" aria-hidden="true"></span>
    <div class="term glass sheen"><div class="scroll"></div></div>
    <div class="corner"><button class="helpbtn glass sheen" style="${gv}" type="button" aria-label="How it works" title="How it works">${HELP_ICON}</button><button class="themebtn glass sheen" style="${gv}" type="button" aria-label="Colour theme" title="Theme"><span class="dot" aria-hidden="true"></span></button>${opts.music ? `<button class="musicbtn glass sheen${opts.music.on ? '' : ' off'}" style="${gv}" type="button" aria-pressed="${opts.music.on}" aria-label="Music" title="Music on / off">${NOTE_ICON}</button>` : ''}</div>
    <div class="ctrl"><button type="button" data-a="prev">◂ PREV</button><button type="button" data-a="auto" aria-pressed="false">AUTO</button><button type="button" data-a="next">NEXT ▸</button></div>
    <div class="splash" role="dialog" aria-label="Welcome">
      <div class="sp-in glass sheen multi">
        <div class="sp-kicker">${esc(brand.kicker.toUpperCase())}</div>
        <h1>${esc(brand.name.toUpperCase())}</h1>
        <p>${brand.intro(STOPS.length, STOPS[0].when, STOPS[STOPS.length - 1].when)}</p>
        <button class="btn glow begin" type="button">BEGIN THE JOURNEY ▸</button>
      </div>
    </div>
    <div class="help glass sheen multi" role="dialog" aria-label="How ${esc(brand.short)} works">
      <div class="lhead"><span>HOW ${esc(brand.short.toUpperCase())} WORKS</span><button class="x" type="button" aria-label="Close help">${X_ICON}</button></div>
      <div class="scroll"><dl>
        <dt>THE TRUNK</dt><dd>Time runs along it. Each bright ring is a new year; where years crowd together, little happened.</dd>
        <dt>A STOP</dt><dd>A line grows out of the opening of a branch and names the event. Click the title to read it; <b>MORE</b> takes you into its branch.</dd>
        <dt>A BRANCH</dt><dd>Each cluster of leaves holds one section: context, what changed, people, sources. <b>DEEPER</b> goes on, <b>BACK</b> steps back, <b>TRUNK</b> takes you straight out.</dd>
        <dt>THE TIMELINE</dt><dd>Top right. Click anywhere on it to fly there; drag it to scrub through time.</dd>
        <dt>${SEARCH_ICON} SEARCH</dt><dd>Type three letters: events, people and words all match.</dd>
        <dt>${LIST_ICON} ALL EVENTS</dt><dd>Every event in order, with its block height and hash.</dd>
        <dt>PREV · NEXT · AUTO</dt><dd>Step through the stops, or let AUTO tour on its own.</dd>
        <dt>BLOCKS + HASHES</dt><dd>Every height and hash opens in the Explorer.</dd>
        <dt>THEMES</dt><dd>The turning dot beside the help box cycles four looks: gold, phosphor, copper and verdigris, prism.</dd>
        <dt>KEYS</dt><dd>← → on the timeline step between stops; Esc closes panels.</dd>
      </dl><button class="btn glow gotit" type="button">GOT IT ▸</button></div>
    </div>
    <div class="zd-scan"></div>`;
  const $ = <T extends HTMLElement = HTMLElement>(q: string) => el.querySelector(q) as T;
  const canvas = $<HTMLCanvasElement>('canvas'), box = $('.box'), term = $('.term'), list = $('.list'), listBtn = $('.listbtn'), slider = $('.slider');
  const hdr = $('.box .hdr'), bd = $('.box .bd'), tEl = $('.box .t'), dEl = $('.box .d'), dbk = $<HTMLButtonElement>('.box .dbk'), typed = $('.box .typed'), oc = $('.box .oc'), more = $('.box .more'), termScroll = $('.term .scroll'), tm = $('.tmeasure');
  const splash = $('.splash'), help = $('.help'), themeDot = $('.themebtn .dot');
  const autoBtn = $('[data-a="auto"]'), cur = $('.track .cur'), fillBar = $('.track .fill'), hudTl = $('.zd-hud.tl');
  const hudWhere = $('[data-k="where"]'), hudDate = $('[data-k="date"]'), hudBlk = $('[data-k="blk"]'), hudEra = $('[data-k="era"]');

  // ── three ──
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = RAW;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(); scene.background = C('#000000'); scene.fog = new THREE.FogExp2(0x000000, 0.022);
  const cam = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 240);
  const mats: LineMaterial[] = [], branches = new Map(STOPS.map((st) => [st, branchFor(st)] as const));
  const { fading: speedFade, recolour } = buildWorld(scene, mats, branches);
  const leadGeo = new LineGeometry(); leadGeo.setPositions([0, 0, 0, 0, 0, 0]);
  const leadMat = new LineMaterial({ color: 0xffffff, linewidth: 2.4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mats.push(leadMat); const lead = new Line2(leadGeo, leadMat); lead.frustumCulled = false; scene.add(lead);
  // Multisampled target: without it the composer drops antialiasing and the linework stair-steps.
  const rt = new THREE.WebGLRenderTarget(16, 16, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, cam));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.95, 0.5, 0.06));

  // ── state ──
  type Mode = 'intro' | 'stop' | 'travel' | 'scrub' | 'branch' | 'return';
  // Opens on the splash, drifting slowly up the trunk toward the first event; nothing moves on its own.
  let idx = 0;
  let s = 2, sPrev = s, scrubTo = s, mode: Mode = 'intro', auto = false, clock = 0;
  let depth = 0, bp = 0, afterReturn: number | null = null, press: { x: number; drag: boolean } | null = null;
  let fly: { from: number; to: number; fromLook: THREE.Vector3; t: number; dur: number } | null = null;
  let bmove: { from: number; to: number; t: number; dur: number; d0: THREE.Vector3; d1: THREE.Vector3 } | null = null;
  const ui = { grow: 0, draw: 0, title: 0, open: 0, body: 0, term: 0 };
  let wantOpen = false, pending: (() => void) | null = null, first = true, bw = 340, stageW = 1000, fov = 72;
  const pos = P(s), look = P(s + 8);
  const brOf = () => branches.get(STOPS[idx]) as Branch;

  // Flights are timed and eased: a long jump ramps up, runs fast, then settles in.
  const flyTo = () => { const to = STOPS[idx].s - CAM_BACK, d = Math.abs(to - s); fly = { from: s, to, fromLook: look.clone(), t: 0, dur: Math.min(2.4, 0.65 + 0.85 * Math.log10(1 + d / 20)) }; mode = 'travel'; clock = 0; };
  // Inside a branch the gaze turns from where you are looking to where you will look on arrival,
  // evenly over the whole move, so the corner at the branch mouth is never one sudden swing.
  const pathAt = (br: Branch, p: number) => br.path.getPointAt(clamp(p / br.plen, 0, 1));
  const gazeAt = (br: Branch, p: number) => (p <= 0.01 ? br.a.look.clone().sub(br.a.rest) : pathAt(br, p + 10).sub(pathAt(br, p))).normalize();
  const moveTo = (to: number) => { bmove = { from: bp, to, t: 0, dur: 0.6 + 0.55 * Math.log10(1 + Math.abs(to - bp) / 4), d0: look.clone().sub(pos).normalize(), d1: gazeAt(brOf(), to) }; clock = 0; };

  // ── theme: the dot turns a quarter per click, always forward ──
  let themeI = Math.max(0, THEMES.findIndex((t) => t.id === (store.get(THEME_KEY) ?? brand.theme))), turns = themeI;
  const applyTheme = (rebuild: boolean) => {
    const t = THEMES[themeI];
    for (const [k, v] of Object.entries(t.css)) el.style.setProperty(k, v);
    el.dataset.theme = t.id;
    themeDot.style.transform = `rotate(${turns * 90}deg)`;
    el.querySelector('.themebtn')?.setAttribute('title', `Theme: ${t.name} · click for next`);
    if (rebuild) recolour(t);
  };
  applyTheme(true);
  // ── splash, then (first visit) the guide, then the very first event ──
  let firstRun = false;
  const showHelp = (on: boolean) => help.classList.toggle('on', on);
  const toStart = () => { idx = 0; fill(); flyTo(); };
  const begin = () => {
    splash.classList.add('gone');
    if (!store.get(HELP_KEY)) { firstRun = true; showHelp(true); } else toStart();
  };
  const closeHelp = () => { showHelp(false); store.set(HELP_KEY, '1'); if (firstRun) { firstRun = false; toStart(); } };

  function measure() {
    const st = STOPS[idx]; tm.textContent = st.title;
    const tw = tm.offsetWidth + 28 + 22, maxW = Math.min(560, stageW * 0.8);
    bw = Math.min(maxW, Math.max(300, tw));
    tEl.classList.toggle('wrap', tw > maxW);
    box.style.setProperty('--bw', bw + 'px');
  }
  function fill() {
    brOf().leaves.forEach((g) => { (g.userData.mat as LineMaterial).opacity = 0.45; g.scale.setScalar(1); });
    const st = STOPS[idx];
    box.style.cssText = metalVars(st.metal); term.style.cssText = metalVars(st.metal);
    measure();
    $('.box .ghost').textContent = st.brief;
    dbk.hidden = !st.debunk;
    oc.innerHTML = st.height != null ? `<span>BLOCK ${blockA(st.height)}</span>${st.hash ? `<span>${hashA(st.hash, st.height, true)}</span>` : ''}` : '';
    el.querySelectorAll<HTMLElement>('.tick').forEach((t) => t.classList.toggle('on', +(t.dataset.i as string) === idx));
    list.querySelectorAll<HTMLElement>('.row').forEach((r) => r.classList.toggle('on', +(r.dataset.i as string) === idx));
    ui.title = 0; ui.body = 0; depth = 0;
  }
  function renderTerm() {
    const st = STOPS[idx], pg = st.pages[depth], n = st.pages.length;
    termScroll.innerHTML = `<h3>${esc(st.title)}</h3>
      <div class="meta"><span class="chip">${esc(st.kind)}</span>${st.when}<button class="share inline" type="button" data-share="section" data-tip="Share this section" aria-label="Copy a link to this section">${LINK_ICON}</button></div>
      <div class="depth">${st.pages.map((_, i) => `<i class="${i === depth ? 'on' : i < depth ? 'past' : ''}"></i>`).join('')}<span>${depth + 1} / ${n} · ${esc(pg.h)}</span></div>
      <section>${pg.html}</section>
      <div class="nav"><button class="btn back" type="button">◂ ${depth ? 'BACK' : 'TRUNK'}</button>${depth < n - 1 ? `<button class="btn glow deeper" type="button">DEEPER ▸ ${esc(st.pages[depth + 1].h)}</button>` : ''}${depth ? '<button class="btn up" type="button">⤒ TRUNK</button>' : ''}</div>`;
    termScroll.scrollTop = 0;
  }
  // Everything that moves on runs through here: boxes collapse, the line withdraws, then it goes.
  const leave = (fn: () => void) => { wantOpen = false; pending = fn; };
  const inBranchMode = () => mode === 'branch' || mode === 'return';
  // ── pulses: soft rings running down the branch you are in and into its tip (built per branch) ──
  const PULSE_N = 48, PULSE_V = 7, PULSE_GAP = 2.6;
  let pulse: { st: Stop; obj: LineSegments2; us: number[]; base: Float32Array } | null = null;
  function pulseFor(st: Stop) {
    if (pulse?.st === st) return pulse;
    if (pulse) { scene.remove(pulse.obj); pulse.obj.geometry.dispose(); pulse.obj.material.dispose(); }
    const b = branches.get(st) as Branch, L = new Lines(), us: number[] = [];
    for (let u = 0.6; u < b.tube.len - 0.2; u += 0.45) { us.push(u); ring(L, b.tube, u, taperAt(b, u) * 0.97, C(st.metal[2]), 1, PULSE_N, 0.03, u); }
    const obj = L.build(1.6, []); obj.material.opacity = 0; obj.visible = false; scene.add(obj);
    return (pulse = { st, obj, us, base: Float32Array.from(L.c) });
  }
  function startEnter(k = 0) { depth = k; bp = 0; mode = 'branch'; moveTo(brOf().stopP[k]); renderTerm(); }
  function startReturn() { mode = 'return'; moveTo(0); }
  function travelTo(i: number) {
    if (inBranchMode()) { afterReturn = i; leave(startReturn); return; }
    leave(() => { idx = i; fill(); flyTo(); });
  }
  const goDepth = (k: number) => leave(() => { depth = k; renderTerm(); moveTo(brOf().stopP[k]); });
  const manual = () => { auto = false; autoBtn.setAttribute('aria-pressed', 'false'); };
  // ── share links: /<brand>?e=<event>&s=<section> ──
  const linkTo = (section: boolean) => {
    const st = STOPS[idx], u = new URL(`/${brand.id}`, window.location.origin);
    u.searchParams.set('e', st.slug);
    if (section) u.searchParams.set('s', st.pages[depth].slug);
    return u.toString();
  };
  async function share(btn: HTMLButtonElement) {
    const ok = await copyText(linkTo(btn.dataset.share === 'section'));
    const tip = btn.dataset.tip ?? '';
    btn.dataset.tip = ok ? 'Link copied' : 'Copy failed'; btn.classList.toggle('ok', ok);
    setTimeout(() => { btn.dataset.tip = tip; btn.classList.remove('ok'); }, 1800);
  }

  // ── list + search ──
  const srch = $('.search'), srchBtn = $('.srchbtn'), qIn = $<HTMLInputElement>('.search .q'), res = $('.search .results');
  const closeList = () => { list.classList.remove('on'); listBtn.setAttribute('aria-expanded', 'false'); };
  const closeSearch = () => { srch.classList.remove('on'); srchBtn.setAttribute('aria-expanded', 'false'); };
  const TAGC: Record<string, string> = { PERSON: '#dccbff', KIND: '#b6ffe8', TEXT: '#e8c48c' };
  const markIn = (text: string, q: string, m: Metal) => { const i = text.toLowerCase().indexOf(q); return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark style="--hc:${m[1]};--hl:${m[2]}">${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`; };
  let hits: { st: Stop; score: number; why: [string, string] | null }[] = [], act = 0;
  function runSearch() {
    const q = qIn.value.trim().toLowerCase();
    if (q.length < 3) { hits = []; res.innerHTML = `<div class="note">${q.length ? `<b>${3 - q.length} MORE</b> TO GO` : `TYPE <b>3 LETTERS</b> TO SEARCH ${STOPS.length} EVENTS`}</div>`; return; }
    hits = [];
    for (const st of STOPS) {
      const t = st.title.toLowerCase().indexOf(q);
      let score = 0, why: [string, string] | null = null;
      if (t >= 0) score = t === 0 ? 4 : 3;
      else {
        const pp = (st.people || []).find((x) => x.toLowerCase().includes(q));
        if (pp) { score = 2; why = ['PERSON', pp]; }
        else if (st.kind.toLowerCase().includes(q)) { score = 1.5; why = ['KIND', st.kind]; }
        else { const b = st.brief.toLowerCase().indexOf(q); if (b >= 0) { score = 1; const a = Math.max(0, b - 26); why = ['TEXT', (a ? '…' : '') + st.brief.slice(a, b + q.length + 40) + '…']; } }
      }
      if (score) hits.push({ st, score, why });
    }
    hits.sort((a, b) => b.score - a.score || a.st.y - b.st.y); act = 0;
    res.innerHTML = hits.length
      ? `<div class="note"><b>${hits.length}</b> ${hits.length === 1 ? 'MATCH' : 'MATCHES'} FOR "${esc(q.toUpperCase())}"</div>` + hits.map((h, n) => { const m = h.st.metal; return `<div class="hit${n === act ? ' act' : ''}" data-i="${h.st.i}" style="--hc:${m[1]}"><div class="ht"><i></i>${markIn(h.st.title, q, m)}</div><div class="hw">${dbkTag(h.st)}${h.st.when}${h.st.height != null ? ' · ' + blockA(h.st.height) : ''}</div>${h.why ? `<div class="hx"><span class="tag" style="color:${TAGC[h.why[0]]}">${h.why[0]}</span>${markIn(h.why[1], q, m)}</div>` : ''}</div>`; }).join('')
      : `<div class="note">NO EVENTS MATCH "<b>${esc(q.toUpperCase())}</b>"</div>`;
  }

  // ── events (one delegated click handler, so teardown is one removeEventListener) ──
  const track = $('.track');
  const fracAt = (x: number) => { const r = track.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1); };
  const scrubAt = (x: number) => { scrubTo = clamp(fracAt(x) * LEN - CAM_BACK, 1, LEN - CAM_BACK - 2); };
  const nearestTo = (sc: number) => { let best = 0; STOPS.forEach((st, i) => { if (Math.abs(st.s - CAM_BACK - sc) < Math.abs(STOPS[best].s - CAM_BACK - sc)) best = i; }); return best; };
  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    // until the journey begins, only the welcome, the guide and the corner buttons respond
    if (mode === 'intro' && !t.closest('.splash, .help, .helpbtn, .themebtn, .musicbtn')) return;
    const a = t.closest<HTMLAnchorElement>('a[data-q]');
    if (a) { if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.button)) { e.preventDefault(); opts.openExplorer(a.dataset.q as string); } return; }
    if (t.closest('a')) return;
    // a DEBUNKED tag in the list or a search result: fly there and on into its debunk section
    const dt = t.closest<HTMLElement>('.list .dbk, .search .dbk');
    if (dt) {
      const st = STOPS[+(dt.dataset.dbk as string)], k = st.pages.findIndex((p) => p.slug === 'debunked');
      manual();
      if (st.i === idx && mode === 'branch') { if (depth !== k) goDepth(k); return; }
      deepTo = k;
      if (st.i === idx && mode === 'stop') clock = 1; else travelTo(st.i);
      return;
    }
    const go = t.closest<HTMLElement>('.list .go, .search .hit, .term .jump');
    if (go) { manual(); travelTo(+(go.dataset.i ?? go.dataset.go as string)); return; }
    if (t.closest('.term .back')) { manual(); if (depth) goDepth(depth - 1); else leave(startReturn); return; }
    if (t.closest('.term .deeper')) { manual(); goDepth(depth + 1); return; }
    if (t.closest('.term .up')) { manual(); leave(startReturn); return; }
    if (t.closest('.box .more')) { manual(); leave(() => startEnter()); return; }
    const sh = t.closest<HTMLButtonElement>('.share');
    if (sh) { void share(sh); return; }
    // DEBUNKED on a card: straight into the branch, to its debunk section
    if (t.closest('.box .dbk')) {
      const k = STOPS[idx].pages.findIndex((p) => p.slug === 'debunked');
      if (mode === 'stop' && !pending && k >= 0) { manual(); leave(() => startEnter(k)); }
      return;
    }
    if (t.closest('.box .hdr')) { if (mode === 'stop' && !pending) { manual(); wantOpen = !wantOpen; } return; }
    if (t.closest('[data-a="prev"]')) { manual(); travelTo((idx - 1 + STOPS.length) % STOPS.length); return; }
    if (t.closest('[data-a="next"]')) { manual(); travelTo((idx + 1) % STOPS.length); return; }
    if (t.closest('[data-a="auto"]')) { auto = !auto; autoBtn.setAttribute('aria-pressed', String(auto)); clock = 0; return; }
    if (t.closest('.listbtn')) { const on = !list.classList.contains('on'); if (on) closeSearch(); list.classList.toggle('on', on); listBtn.setAttribute('aria-expanded', String(on)); return; }
    if (t.closest('.srchbtn')) { if (srch.classList.contains('on')) closeSearch(); else { closeList(); srch.classList.add('on'); srchBtn.setAttribute('aria-expanded', 'true'); setTimeout(() => qIn.focus(), 40); } return; }
    if (t.closest('.list .x')) { closeList(); return; }
    if (t.closest('.search .x')) { closeSearch(); return; }
    if (t.closest('.splash .begin')) { begin(); return; }
    if (t.closest('.help .x, .help .gotit')) { closeHelp(); return; }
    const mb = t.closest<HTMLElement>('.musicbtn');
    if (mb && opts.music) { const on = opts.music.toggle(); mb.classList.toggle('off', !on); mb.setAttribute('aria-pressed', String(on)); return; }
    if (t.closest('.helpbtn')) { if (help.classList.contains('on')) closeHelp(); else showHelp(true); return; }
    if (t.closest('.themebtn')) { themeI = (themeI + 1) % THEMES.length; turns++; store.set(THEME_KEY, THEMES[themeI].id); applyTheme(true); }
  };
  // The list and search stay open while you travel; a click anywhere outside them closes them.
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (list.classList.contains('on') && !list.contains(t) && !listBtn.contains(t)) closeList();
    if (srch.classList.contains('on') && !srch.contains(t) && !srchBtn.contains(t)) closeSearch();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target === qIn) {
      if (e.key === 'Escape') { closeSearch(); return; }
      if (!hits.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
        const rows = res.querySelectorAll('.hit'); rows.forEach((r, n) => r.classList.toggle('act', n === act)); rows[act].scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter') { manual(); travelTo(hits[act].st.i); }
      return;
    }
    if (e.key === 'Escape') { closeList(); closeSearch(); if (help.classList.contains('on')) closeHelp(); }
    if (e.target === slider && e.key === 'ArrowRight') { manual(); travelTo(Math.min(STOPS.length - 1, idx + 1)); }
    if (e.target === slider && e.key === 'ArrowLeft') { manual(); travelTo(Math.max(0, idx - 1)); }
  };
  // The timeline: a click flies there from where you are; only a drag scrubs.
  const onSDown = (e: PointerEvent) => { if (mode === 'intro') return; manual(); slider.setPointerCapture(e.pointerId); press = { x: e.clientX, drag: false }; };
  const onSMove = (e: PointerEvent) => {
    if (!press || !slider.hasPointerCapture(e.pointerId)) return;
    if (!press.drag && Math.abs(e.clientX - press.x) > 5 && !inBranchMode()) { press.drag = true; wantOpen = false; pending = () => {}; fly = null; mode = 'scrub'; }
    if (press.drag) scrubAt(e.clientX);
  };
  const onSUp = (e: PointerEvent) => {
    if (!press) return;
    const wasDrag = press.drag; press = null;
    if (wasDrag && mode === 'scrub') { pending = null; idx = nearestTo(scrubTo); fill(); flyTo(); return; }
    if (!wasDrag && e.type === 'pointerup') travelTo(nearestTo(fracAt(e.clientX) * LEN - CAM_BACK));
  };
  el.addEventListener('click', onClick);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('keydown', onKey);
  qIn.addEventListener('input', runSearch);
  slider.addEventListener('pointerdown', onSDown);
  slider.addEventListener('pointermove', onSMove);
  slider.addEventListener('pointerup', onSUp);
  slider.addEventListener('pointercancel', onSUp);

  fill();
  function resize() {
    const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
    stageW = w;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    const px = renderer.getPixelRatio(); for (const m of mats) m.resolution.set(w * px, h * px);
    measure();
  }
  const ro = new ResizeObserver(resize); ro.observe(el); resize();

  const tp = new V(), tl = new V(), tmp = new V();
  let deepLink = () => {};
  function step(dt: number) {
    clock += dt;
    const st = STOPS[idx], br = brOf(), now = performance.now() / 1000;
    const { W, E } = br.a;

    // ── choreography: fast in, faster out ──
    if (pending) {
      ui.term = approach(ui.term, 0, 1 / 0.08, dt);
      ui.open = approach(ui.open, 0, 1 / 0.07, dt);
      if (!ui.open) ui.draw = approach(ui.draw, 0, 1 / 0.07, dt);
      if (!ui.draw) ui.grow = approach(ui.grow, 0, 1 / 0.1, dt);
      if (!ui.term && !ui.open && !ui.draw && !ui.grow) { const fn = pending as () => void; pending = null; ui.title = ui.body = 0; fn(); }
    } else if (mode === 'stop') {
      ui.grow = approach(ui.grow, 1, 1 / 0.16, dt);
      if (ui.grow === 1) ui.draw = approach(ui.draw, 1, 1 / 0.08, dt);
      if (ui.draw === 1) ui.title = Math.min(st.title.length, ui.title + (reduced ? 1e9 : 260) * dt);
      ui.open = approach(ui.open, wantOpen ? 1 : 0, 1 / (wantOpen ? 0.11 : 0.07), dt);
      if (wantOpen && ui.open > 0.4) ui.body = Math.min(st.brief.length, ui.body + (reduced ? 1e9 : 820) * dt);
      if (!wantOpen) ui.body = 0;
    } else if (mode === 'branch' && !bmove) {
      ui.term = approach(ui.term, 1, 1 / 0.13, dt);
    }

    // ── movement ──
    if (mode === 'travel') {
      if (!fly) flyTo();
      const f = fly as NonNullable<typeof fly>;
      f.t += dt; const k = Math.min(1, f.t / f.dur);
      s = f.from + (f.to - f.from) * smoother(k);
      if (k >= 1) { fly = null; mode = 'stop'; clock = 0; }
    } else if (mode === 'intro') {
      s = Math.min(s + dt * 1.1, STOPS[0].s - CAM_BACK - 4);
    } else if (mode === 'scrub') {
      s += (scrubTo - s) * (1 - Math.exp(-dt * 6));
    } else if (bmove) {
      bmove.t += dt; const k = Math.min(1, bmove.t / bmove.dur);
      bp = bmove.from + (bmove.to - bmove.from) * smoother(k);
      if (k >= 1) {
        bmove = null; clock = 0;
        if (mode === 'return') {
          mode = 'stop'; depth = 0;
          const go = afterReturn; afterReturn = null;
          if (go != null) travelTo(go); else if (auto) travelTo((idx + 1) % STOPS.length);
        }
      }
    }

    deepLink();
    // ── autopilot: read, sometimes walk into the branch a few sections, carry on ──
    if (auto && !pending) {
      if (mode === 'stop' && !wantOpen && ui.title >= st.title.length && clock > 0.9) { wantOpen = true; clock = 0; }
      else if (mode === 'stop' && wantOpen && ui.body >= st.brief.length && clock > 3.2) {
        if (idx % 3 === 1) leave(() => startEnter()); else travelTo((idx + 1) % STOPS.length);
      } else if (mode === 'branch' && !bmove && ui.term === 1 && clock > 4.2) {
        if (depth < Math.min(st.pages.length - 1, 2)) goDepth(depth + 1); else leave(startReturn);
      }
    }

    // ── camera: rides its line exactly; only the stop's idle drift is smoothed ──
    const speed = Math.abs(s - sPrev) / Math.max(dt, 1e-3); sPrev = s;
    if (inBranchMode()) {
      tp.copy(pathAt(br, bp));
      const d = bmove ? bmove.d0.clone().lerp(bmove.d1, smoother(Math.min(1, bmove.t / bmove.dur))).normalize() : gazeAt(br, bp);
      tl.copy(tp).addScaledVector(d, 10);
    } else {
      tp.copy(P(s)).addScaledVector(frameAt(s).U, 0.25);
      tl.copy(P(s + 9));
      if (mode === 'stop') tl.copy(br.a.look);
      else if (mode === 'travel' && fly) {
        // leave the old stop's gaze and settle into the new one over the first and last stretch
        const span = Math.min(10, Math.abs(fly.to - fly.from) / 2.5) || 1;
        tl.lerp(fly.fromLook, smoother(1 - Math.abs(s - fly.from) / span));
        tl.lerp(br.a.look, smoother(1 - Math.abs(fly.to - s) / span));
      }
      if (mode === 'stop') { tp.x += Math.sin(now * 0.7) * 0.07; tp.y += Math.cos(now * 0.53) * 0.05; }
    }
    const ride = first || mode !== 'stop';
    pos.lerp(tp, ride ? 1 : 1 - Math.exp(-dt * 8));
    look.lerp(tl, ride ? 1 : 1 - Math.exp(-dt * 8));
    first = false;
    cam.position.copy(pos); cam.lookAt(look);
    const fovT = 72 + Math.min(8, speed * 0.008);
    fov += (fovT - fov) * (1 - Math.exp(-dt * 5));
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    // Rings pass faster than frames at speed and read as moving backwards; fade them out and let
    // the lengthwise grain streak instead.
    const vis = clamp(1 - (speed - 35) / 160, 0.04, 1);
    for (const m of speedFade) m.opacity += (vis - m.opacity) * (1 - Math.exp(-dt * 12));
    box.style.setProperty('--open', ease(ui.open).toFixed(3));

    // ── leaves: the section you are reading glows ──
    br.leaves.forEach((g, k) => {
      const on = mode === 'branch' && !bmove && k === depth, m = g.userData.mat as LineMaterial;
      m.opacity += ((on ? 1 : 0.45) - m.opacity) * (1 - Math.exp(-dt * 8));
      g.scale.setScalar(on ? 1 + 0.035 * Math.sin(now * 2.4) : 1);
    });

    // ── pulses ──
    if (inBranchMode() && !reduced) pulseFor(st);
    if (pulse) {
      const pm = pulse.obj.material, on = inBranchMode() && pulse.st === st && !reduced;
      pm.opacity += ((on ? 1 : 0) - pm.opacity) * (1 - Math.exp(-dt * (on ? 2 : 8)));
      pulse.obj.visible = pm.opacity > 0.01;
      if (pulse.obj.visible) {
        pm.resolution.copy(leadMat.resolution);
        const len = (branches.get(pulse.st) as Branch).tube.len, gap = PULSE_V * PULSE_GAP, head = (now * PULSE_V) % gap;
        const buf = pulse.obj.geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute, arr = buf.data.array as Float32Array;
        pulse.us.forEach((u, j) => {
          let k = 0; for (let c = head; c < len + 2; c += gap) k += Math.exp(-(((u - c) / 0.75) ** 2));
          k *= 0.24 * Math.min(1, u / 6);
          for (let i = j * PULSE_N * 6, e = i + PULSE_N * 6; i < e; i++) arr[i] = pulse!.base[i] * k;
        });
        buf.data.needsUpdate = true;
      }
    }

    // ── leader line ──
    const g = ease(ui.grow); tmp.copy(W).lerp(E, g);
    leadGeo.setPositions([W.x, W.y, W.z, tmp.x, tmp.y, tmp.z]);
    leadMat.color.setStyle(st.metal[2], RAW); leadMat.opacity = g > 0.001 ? 1 : 0;

    // ── the box, pinned to the end of the line ──
    const q = E.clone().project(cam), w = el.clientWidth, h = el.clientHeight;
    const x = (q.x * 0.5 + 0.5) * w, y = (-q.y * 0.5 + 0.5) * h;
    const hdrH = hdr.offsetHeight, bdH = bd.offsetHeight;
    const cw = bw * ease(ui.draw), ch = ui.draw > 0 ? Math.max(2, hdrH * Math.min(1, ui.draw * 1.6)) + bdH * ease(ui.open) : 0;
    // extend away from where the line comes from, so the box never sits on its own line
    const left = W.clone().project(cam).x > q.x;
    const bx = Math.max(10, Math.min(left ? x - 10 - cw : x + 10, w - cw - 10));
    box.style.left = bx + 'px'; box.style.top = Math.max(76, Math.min(y - hdrH / 2, h - ch - 64)) + 'px';
    box.style.width = cw + 'px'; box.style.height = ch + 'px'; box.classList.toggle('left', left);
    box.style.visibility = q.z > 1 || ui.draw === 0 ? 'hidden' : '';
    const nt = Math.floor(ui.title), head = st.when + ' · ' + st.kind;
    tEl.textContent = st.title.slice(0, nt) + (nt < st.title.length && ui.draw === 1 ? '▌' : '');
    dEl.textContent = head.slice(0, Math.floor(ui.title / st.title.length * head.length) || 0);
    const nb = Math.floor(ui.body), done = nb >= st.brief.length;
    typed.textContent = st.brief.slice(0, nb) + (nb && !done ? '▌' : '');
    oc.style.opacity = more.style.opacity = done ? '1' : '0';

    // ── branch terminal ──
    const full = Math.min(h - 86 - 70, termScroll.scrollHeight);
    term.style.height = (full * ease(ui.term)) + 'px';
    term.style.visibility = ui.term > 0 ? '' : 'hidden';

    // ── HUD ──
    const inB = inBranchMode(), here = mode === 'stop' || inB;
    const yy = here ? st.y : yOfS(s + CAM_BACK);
    const era = eraOf(yy), em = METAL[era[2]];
    hudWhere.textContent = inB ? `BRANCH · ${depth + 1}/${st.pages.length}` : 'TRUNK';
    hudDate.textContent = here ? st.when : new Date(Date.UTC(Math.floor(yy), 0, 1) + (yy - Math.floor(yy)) * YEAR_MS).toISOString().slice(0, 10);
    const exact = here && st.height != null, hh = exact ? st.height : heightAtY(yy);
    const blkHtml = hh == null ? 'PRE-GENESIS' : `BLOCK ${exact ? '' : '≈'}${blockA(hh)}`;
    if (hudBlk.dataset.v !== blkHtml) { hudBlk.innerHTML = blkHtml; hudBlk.dataset.v = blkHtml; }
    hudBlk.style.color = em[2];
    hudEra.textContent = 'ERA: ' + era[1]; hudEra.style.color = em[1];
    hudTl.style.cssText = metalVars(em);
    const f = clamp((s + CAM_BACK) / LEN, 0, 1);
    cur.style.left = (f * 100) + '%'; fillBar.style.width = (f * 100) + '%';
  }

  let visible = true, last = performance.now(), raf = 0;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = performance.now(); }, { threshold: 0.02 });
  io.observe(el);
  // A shared link opens on its event (card open), or flies on into the branch to its section.
  let deepTo: number | null = null;
  const want = opts.start?.event ? STOPS.find((x) => x.slug === opts.start!.event) : null;
  if (want) {
    splash.classList.add('gone');
    idx = want.i; fill(); s = want.s - CAM_BACK; mode = 'stop'; wantOpen = true; clock = 0;
    const k = opts.start?.section ? want.pages.findIndex((p) => p.slug === opts.start!.section) : -1;
    if (k >= 0) deepTo = k;
  }
  deepLink = () => {
    if (deepTo == null || mode !== 'stop' || pending || ui.title < STOPS[idx].title.length || clock < 0.7) return;
    const k = deepTo; deepTo = null; leave(() => startEnter(k));
  };
  // a still first frame: the mouth of the trunk behind the welcome (or the shared event)
  step(0.016); composer.render();
  // rAF time can trail performance.now() (set by the observer), so a step is never negative
  const frame = (t: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) { last = t; return; }
    const dt = Math.max(0, Math.min(0.05, (t - last) / 1000)); last = Math.max(last, t);
    step(dt); composer.render();
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    if (pulse) { scene.remove(pulse.obj); pulse.obj.geometry.dispose(); pulse.obj.material.dispose(); }
    ro.disconnect(); io.disconnect();
    el.removeEventListener('click', onClick);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('keydown', onKey);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of mat ? (Array.isArray(mat) ? mat : [mat]) : []) { (x as THREE.SpriteMaterial).map?.dispose(); x.dispose(); }
    });
    composer.dispose(); rt.dispose(); renderer.dispose();
    el.innerHTML = '';
  };
}
