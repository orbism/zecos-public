/**
 * Zkyline: an endless rooftop runner. Jump, double jump, slide, fast-fall;
 * no fighting, only escape. The world is procedural from a seed, so every run
 * is different.
 *
 * Everything is drawn in shades of grey into a small offscreen canvas, then
 * pushed through a colour lookup table (a gradient map). The table is what
 * changes over a run: monochrome first, then duotone, vapour, neon, and
 * finally a full psychedelic hue cycle that wobbles by screen band. Anything
 * that can kill you is drawn in the brightest band (250 to 255), which the
 * table always maps to its hazard colour, so it reads in every palette.
 */

export const W = 480;
export const H = 270;
const PX = 96;            // the runner's screen x
const PW = 10;            // hitbox width
const STAND = 22, SLIDE = 11;
const G = 1500, JUMP = 490, DJUMP = 430, BOUNCE = 650, MAX_FALL = 900;
const BASE = 170, RAMP = 2.2, TOP_SPEED = 430;
/** Past TOP_SPEED it never stops, it just creeps: this much more per second. */
const CREEP = 0.45;
const T_TOP = (TOP_SPEED - BASE) / RAMP;
/** A tunnel's opening: standing (22) fits, a jump inside does not. */
const TUNNEL = 34;
const POWER_SECS = { triple: 14, glide: 12 } as const;
const COYOTE = 0.1, BUFFER = 0.13;
/** The second jump waits this long after the first, so a fast double-tap still lands as a real double. */
const DJ_GAP = 0.13;
/** Air time after which a long jump earns a roll. */
const ROLL_AFTER = 0.5;
/** Where the ground lives: kept well clear of the bottom edge, where overlays sit. */
const RUNWAY = 182, ROOF_TOP = 104, ROOF_LOW = 196, STREET = 206;

export type Biome = 'roof' | 'alley' | 'market';
type Kind = 'crate' | 'sign' | 'drone' | 'cart' | 'bot' | 'laser';
interface Plat {
  x: number; w: number; y: number; biome: Biome; bounce?: boolean;
  /** One-way from above, no wall: hovering platforms. */
  thin?: boolean;
  /** A hovering platform's path: base position, sway, speed. */
  move?: { bx: number; by: number; ax: number; ay: number; ph: number; sp: number };
  /** A roof that gives way: -1 armed, then seconds since it was stood on. */
  crumble?: number; fallV?: number;
}
/** A building with a tunnel through it: a roof you can land on, a ceiling that kills a jump, glass at both ends. */
interface Block { x: number; w: number; top: number; bottom: number; floor: number; glassIn: boolean; glassOut: boolean }
type PowerKind = 'triple' | 'shield' | 'glide';
interface Pickup { kind: PowerKind; x: number; y: number; taken: boolean }
interface Ob { kind: Kind; x: number; y: number; w: number; h: number; base: number; amp: number; phase: number; vx: number; min: number; max: number }
interface Ship { layer: number; x: number; y: number; vx: number; s: number; t: number }
interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; l: number; size: number }

type PropKind = 'birds' | 'laundry' | 'puddle' | 'cans' | 'chimes' | 'papers';
/** Scenery that reacts when the runner goes through it. Never harmful, never in the hazard band. */
interface Prop { kind: PropKind; x: number; y: number; w: number; hit: number; seed: number; bits: { x: number; y: number; vx: number; vy: number; a: number; va: number }[] }
interface Pose { lean: number; thF: number; knF: number; thB: number; knB: number; shF: number; elF: number; shB: number; elB: number; crouch: number }

export interface Hud { tenths: number; speed: number; phase: string; state: 'ready' | 'run' | 'dead' | 'paused'; reason: string | null; powers: { triple: number; glide: number; shield: boolean } }

/** mulberry32: small, fast, good enough for level layout. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashR = (seed: number, n: number, layer: number) => rng((seed ^ Math.imul(n, 2654435761) ^ Math.imul(layer + 1, 40503)) >>> 0);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ── palettes ──────────────────────────────────────────────────────────────────
type Stops = [number, string][];
const PALETTES: { name: string; at: number; stops: Stops | null; hazard: string }[] = [
  { name: 'MONO', at: 0, stops: [[0, '#000000'], [40, '#151515'], [200, '#d8d8d8'], [249, '#ffffff']], hazard: '#ffffff' },
  { name: 'DUSK', at: 18, stops: [[0, '#07081c'], [60, '#1f2150'], [130, '#55407a'], [200, '#f29e5c'], [249, '#ffe9c4']], hazard: '#ff3b3b' },
  { name: 'VAPOR', at: 40, stops: [[0, '#10001f'], [70, '#3c155c'], [140, '#1fb5a8'], [210, '#ffaec0'], [249, '#fff4e4']], hazard: '#ff2e88' },
  { name: 'NEON', at: 65, stops: [[0, '#000000'], [50, '#16002e'], [120, '#ff00aa'], [185, '#00e5ff'], [249, '#f6ff3a']], hazard: '#ff2a2a' },
  { name: 'ACID', at: 92, stops: null, hazard: '' },
];
const BLEND = 4;
const BANDS = Math.ceil(H / 8);

function hex(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function stopsLut(stops: Stops, hazard: string, out: Float32Array, o: number, flash: number) {
  const s = stops.map(([l, c]) => [l, ...hex(c)] as [number, number, number, number]);
  const hz = hex(hazard);
  for (let l = 0; l < 256; l++) {
    let c: [number, number, number];
    if (l >= 250) c = [lerp(hz[0], 255, flash), lerp(hz[1], 255, flash), lerp(hz[2], 255, flash)];
    else {
      let i = 0; while (i < s.length - 2 && l > s[i + 1]![0]) i++;
      const a = s[i]!, b = s[i + 1]!, t = clamp((l - a[0]) / Math.max(1, b[0] - a[0]), 0, 1);
      c = [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    }
    out[o + l * 3] = c[0]; out[o + l * 3 + 1] = c[1]; out[o + l * 3 + 2] = c[2];
  }
}
function acidLut(time: number, band: number, out: Float32Array, o: number, flash: number) {
  const base = time * 40 + Math.sin(band * 0.35 + time * 1.7) * 50;
  for (let l = 0; l < 256; l++) {
    let c: [number, number, number];
    if (l >= 250) { const h = hsl((base + 180) % 360, 1, 0.55); c = [lerp(h[0], 255, flash), lerp(h[1], 255, flash), lerp(h[2], 255, flash)]; }
    else c = hsl((base + l * 1.25) % 360, 0.95, 0.04 + (l / 249) * 0.62);
    out[o + l * 3] = c[0]; out[o + l * 3 + 1] = c[1]; out[o + l * 3 + 2] = c[2];
  }
}

// ── the game ──────────────────────────────────────────────────────────────────
export class Zkyline {
  seed: number;
  private r: () => number;
  state: Hud['state'] = 'ready';
  /** Things that happened since the host last looked: for sound. */
  events: string[] = [];
  reason: string | null = null;
  t = 0;
  speed = BASE;
  cam = 0;
  private y = RUNWAY; private vy = 0; private ground = true; private jumps = 0; private coyote = 0; private buffer = 0;
  private jumpHeld = false; private downHeld = false; private sliding = false;
  private trail: { y: number; a: number; rot: number }[] = [];
  private jumpAt = -9;
  private trailTick = 0;
  private airT = 0;
  private rolledThisAir = false;
  private roll: { t: number; dur: number } | null = null;
  private landT = 0;
  private stride = 0;
  private pose: Pose = { ...POSES.run };
  private scarf: { x: number; y: number; px: number; py: number }[] = Array.from({ length: 8 }, () => ({ x: PX, y: RUNWAY - 18, px: PX, py: RUNWAY - 18 }));
  private props: Prop[] = [];
  private blocks: Block[] = [];
  private pickups: Pickup[] = [];
  private pickupNext = 12;
  private powers = { triple: 0, glide: 0, shield: false };
  private invuln = 0;
  private gliding = false;
  private standOn: Plat | null = null;
  private plats: Plat[] = [];
  private obs: Ob[] = [];
  private ships: Ship[] = [];
  private parts: Part[] = [];
  private lines: { x: number; y: number; len: number }[] = [];
  private biome: Biome = 'roof';
  private biomeLeft = 6;
  private nextShip = 2;
  private shake = 0;
  private flash = 0;
  private deadT = 0;
  private clock = 0;   // always ticks, for idle animation
  private lum: CanvasRenderingContext2D;
  private sky: HTMLCanvasElement;
  private lut = new Float32Array(BANDS * 256 * 3);
  private grey: string[] = Array.from({ length: 256 }, (_, i) => `rgb(${i},${i},${i})`);

  constructor(seed: number) {
    this.seed = seed;
    this.r = rng(seed);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    this.lum = c.getContext('2d', { willReadFrequently: true })!;
    this.sky = document.createElement('canvas'); this.sky.width = W; this.sky.height = H;
    const s = this.sky.getContext('2d')!;
    const g = s.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e0e0e'); g.addColorStop(0.7, '#2c2c2c'); g.addColorStop(1, '#3c3c3c');
    s.fillStyle = g; s.fillRect(0, 0, W, H);
    const sr = rng(seed ^ 0x51ed);
    for (let i = 0; i < 90; i++) { const v = 120 + Math.floor(sr() * 120); s.fillStyle = `rgb(${v},${v},${v})`; s.fillRect(Math.floor(sr() * W), Math.floor(sr() * H * 0.6), 1, 1); }
    // the runway: long and flat, so the first second is free
    this.plats.push({ x: -200, w: 760, y: RUNWAY, biome: 'roof' });
    this.y = RUNWAY;
  }

  // input
  press() {
    if (this.state === 'ready') this.state = 'run';
    if (this.state !== 'run') return;
    this.jumpHeld = true; this.buffer = BUFFER;
  }
  release() { this.jumpHeld = false; }
  down(on: boolean) { this.downHeld = on; }
  pause(on: boolean) { if (on && this.state === 'run') this.state = 'paused'; else if (!on && this.state === 'paused') this.state = 'run'; }

  get tenths() { return Math.floor(this.t * 10); }
  phaseName() { let p = PALETTES[0]!; for (const q of PALETTES) if (this.t >= q.at) p = q; return p.name; }
  hud(): Hud { return { tenths: this.tenths, speed: this.speed, phase: this.phaseName(), state: this.state, reason: this.reason, powers: { ...this.powers } }; }

  // ── world generation ──
  private lastEnd() { const p = this.solidLast(); return p.x + p.w; }
  private solidLast() { for (let i = this.plats.length - 1; i >= 0; i--) if (!this.plats[i]!.bounce) return this.plats[i]!; return this.plats[0]!; }

  private gen() {
    const r = this.r, v = this.speed, prev = this.solidLast();
    if (--this.biomeLeft <= 0) {
      const opts: Biome[] = (['roof', 'alley', 'market'] as Biome[]).filter((b) => b !== this.biome);
      this.biome = opts[Math.floor(r() * opts.length)]!;
      this.biomeLeft = 5 + Math.floor(r() * 7);
    }
    const b = this.biome;
    if (this.t > 6 && b !== 'market' && r() < 0.14) return this.genTunnel(prev, b);
    if (this.t > 14 && r() < 0.1) return this.genMovers(prev, b);
    let y: number;
    if (b === 'roof') y = clamp(prev.y + Math.round((r() - 0.45) * 110), ROOF_TOP, ROOF_LOW);
    else y = STREET + Math.round((r() - 0.5) * 8);
    if (prev.y - y > 55) y = prev.y - 55; // never a climb a single jump cannot make
    const rise = prev.y - y;
    const gapChance = b === 'roof' ? 0.78 : b === 'alley' ? 0.3 : 0.35;
    let gap = 0;
    if (r() < gapChance || rise > 0) {
      const maxGap = Math.min(v * (rise > 30 ? 0.42 : 0.6), b === 'roof' ? 190 : 80);
      gap = Math.round(lerp(28, Math.max(30, maxGap), r()));
    }
    const w = Math.round(b === 'roof' ? lerp(110, 320, r()) : b === 'alley' ? lerp(240, 520, r()) : lerp(220, 460, r()));
    const x = prev.x + prev.w + gap;
    const p: Plat = { x, w, y, biome: b };
    if (b === 'roof' && this.t > 20 && r() < 0.13) { p.w = Math.round(lerp(80, 150, r())); p.crumble = -1; }
    this.plats.push(p);
    if (p.crumble === undefined) this.dress(p); else this.scatterProps(p);
    this.maybePickup(p, p.y - 34 - r() * 16);
  }

  /** A building to run through: a porch, glass, a low tunnel (slide under the pipes), glass, a porch. */
  private genTunnel(prev: Plat, b: Biome) {
    const r = this.r, v = this.speed;
    let y = b === 'roof' ? clamp(prev.y + Math.round((r() - 0.3) * 50), ROOF_TOP + 40, ROOF_LOW) : STREET;
    if (prev.y - y > 50) y = prev.y - 50;
    const rise = prev.y - y;
    // gap + porch is always longer than a full jump at this speed, so a jump in lands before the glass
    const gap = rise > 0 ? Math.round(lerp(28, Math.max(30, Math.min(v * 0.32, 100)), r())) : r() < 0.6 ? Math.round(lerp(28, Math.max(30, Math.min(v * 0.35, 120)), r())) : 0;
    const porch = Math.round(Math.max(56, v * 0.45) + r() * 40), len = Math.round(170 + r() * 230), exit = Math.round(44 + r() * 30);
    const x = prev.x + prev.w + gap;
    const floor: Plat = { x, w: porch + len + exit, y, biome: b };
    this.plats.push(floor);
    const bottom = y - TUNNEL;
    const blk: Block = { x: x + porch, w: len, bottom, top: Math.max(14, bottom - Math.round(18 + r() * 60)), floor: y, glassIn: true, glassOut: true };
    this.blocks.push(blk);
    // low pipes inside: slide under them
    let px = blk.x + Math.max(70, v * 0.5);
    while (px < blk.x + blk.w - 40) {
      if (r() < 0.5) this.obs.push({ kind: 'sign', x: px, y: bottom, w: 14, h: y - 15 - bottom, base: bottom, amp: 0, phase: 0, vx: 0, min: 0, max: 0 });
      px += Math.max(90, v * 0.6) + r() * 80;
    }
    this.maybePickup(floor, y - 12, blk.x + blk.w * 0.5);
  }

  /** A wide gap with hovering platforms bobbing across it. */
  private genMovers(prev: Plat, b: Biome) {
    const r = this.r, v = this.speed;
    const n = r() < 0.55 ? 2 : 1, mw = 58;
    const sideways = r() < 0.35;
    const hop = Math.round(Math.min(v * 0.42, 125) - (sideways ? 22 : 0));
    let x = prev.x + prev.w + hop, y = prev.y;
    for (let i = 0; i < n; i++) {
      y = clamp(y + Math.round((r() - 0.5) * 40), ROOF_TOP + 24, ROOF_LOW - 10);
      const m = { bx: x, by: y, ax: sideways ? 20 : 0, ay: sideways ? 4 : 16 + r() * 18, ph: r() * 6.28, sp: 1.5 + r() * 0.9 };
      this.plats.push({ x, w: mw, y, biome: b, thin: true, move: m });
      x += mw + hop;
    }
    const land: Plat = { x, w: Math.round(lerp(160, 300, r())), y: clamp(y + Math.round((r() - 0.5) * 30), ROOF_TOP, ROOF_LOW), biome: b };
    this.plats.push(land);
    this.dress(land);
  }

  /** Every so often, a pickup floats over the new ground. */
  private maybePickup(p: Plat, y: number, at?: number) {
    // the world is built a few seconds ahead, so place it a little early
    if (this.t < this.pickupNext - 4) return;
    const r = this.r;
    const kinds: PowerKind[] = ['triple', 'shield', 'glide'];
    this.pickups.push({ kind: kinds[Math.floor(r() * 3)]!, x: at ?? p.x + p.w * (0.35 + r() * 0.3), y, taken: false });
    this.pickupNext = this.t + 18 + r() * 14;
  }

  /** Obstacles, enemies and bounce pads on one platform. */
  private dress(p: Plat) {
    const r = this.r, d = clamp(this.t / 120, 0, 1), v = this.speed;
    const moving = this.t > 8;
    let x = p.x + 60;
    const end = p.x + p.w - 50;
    while (true) {
      x += Math.max(95, v * 0.55) + r() * 130;
      if (x > end) break;
      if (r() > 0.38 + d * 0.4) continue;
      const roll = r();
      let kind: Kind | 'awning';
      if (this.t > 25 && p.biome !== 'market' && r() < 0.14) kind = 'laser';
      else if (p.biome === 'roof') kind = roll < 0.4 ? 'crate' : roll < 0.65 ? (moving ? 'drone' : 'crate') : roll < 0.82 ? 'sign' : (moving ? 'bot' : 'sign');
      else if (p.biome === 'alley') kind = roll < 0.3 ? 'crate' : roll < 0.6 ? 'sign' : roll < 0.8 ? (moving ? 'cart' : 'crate') : (moving ? 'drone' : 'sign');
      else kind = roll < 0.3 ? 'awning' : roll < 0.55 ? 'crate' : roll < 0.8 ? (moving ? 'cart' : 'crate') : 'sign';
      if (kind === 'awning') { this.plats.push({ x, w: 34, y: p.y - 24, biome: p.biome, bounce: true }); continue; }
      const o: Ob = { kind, x, y: p.y, w: 16, h: 16, base: p.y, amp: 0, phase: r() * 6.28, vx: 0, min: p.x + 8, max: p.x + p.w - 30 };
      if (kind === 'crate') { o.w = 14 + Math.round(r() * 12); o.h = 13 + Math.round(r() * 9); o.y = p.y - o.h; }
      if (kind === 'sign') { o.w = 18; o.h = 43; o.y = p.y - 58; }
      if (kind === 'drone') { o.w = 15; o.h = 9; o.base = p.y - 22 - r() * 34; o.amp = 8 + r() * 14; o.vx = -(30 + r() * 40); o.y = o.base; }
      if (kind === 'cart') { o.w = 22; o.h = 13; o.y = p.y - 13; o.vx = 55 + r() * 30; }
      if (kind === 'bot') { o.w = 10; o.h = 18; o.y = p.y - 18; o.vx = 30 + r() * 20; }
      if (kind === 'laser') { o.w = 4; o.h = 58; o.y = p.y - 58; o.amp = 1.6 + r() * 0.6; }
      this.obs.push(o);
    }
    this.scatterProps(p);
  }

  // ── simulation ──
  update(dt: number) {
    this.clock += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.stepParts(dt);
    this.animate(dt);
    this.stepShips(dt, this.state === 'run' ? this.speed : this.state === 'ready' ? 60 : 0);
    if (this.state === 'dead') { this.deadT += dt; this.vy = Math.min(MAX_FALL, this.vy + G * dt); this.y += this.vy * dt; return; }
    if (this.state === 'paused') return;
    if (this.state === 'ready') { this.cam += 60 * dt; this.keepGround(); this.ensure(); return; }

    this.t += dt;
    this.speed = this.t < T_TOP ? BASE + RAMP * this.t : TOP_SPEED + (this.t - T_TOP) * CREEP;
    this.cam += this.speed * dt;
    this.ensure();

    // obstacles move
    for (const o of this.obs) {
      if (o.kind === 'drone') { o.x += o.vx * dt; o.y = o.base + Math.sin(this.clock * 2.3 + o.phase) * o.amp; }
      if (o.kind === 'cart' || o.kind === 'bot') {
        o.x += o.vx * dt;
        if (o.x < o.min) { o.x = o.min; o.vx = Math.abs(o.vx); }
        if (o.x > o.max) { o.x = o.max; o.vx = -Math.abs(o.vx); }
      }
    }

    // hovering and crumbling platforms
    for (const p of this.plats) {
      if (p.move) { const s2 = Math.sin(this.clock * p.move.sp + p.move.ph); p.x = p.move.bx + s2 * p.move.ax; p.y = p.move.by + s2 * p.move.ay; }
      if (p.crumble !== undefined && p.crumble >= 0) {
        p.crumble += dt;
        if (p.crumble > 0.55) { p.fallV = (p.fallV ?? 0) + 1100 * dt; p.y += p.fallV * dt; }
      }
    }
    if (this.ground && this.standOn && (this.standOn.move || this.standOn.fallV)) this.y = this.standOn.y;
    this.powers.triple = Math.max(0, this.powers.triple - dt);
    this.powers.glide = Math.max(0, this.powers.glide - dt);
    this.invuln = Math.max(0, this.invuln - dt);

    // the runner
    this.coyote -= dt; this.buffer -= dt;
    let g = G;
    if (this.vy < 0 && !this.jumpHeld) g *= 2.3;          // short hop on a quick tap
    if (this.downHeld && !this.ground) g = 3300;           // fast-fall
    this.vy = Math.min(MAX_FALL, this.vy + g * dt);
    this.gliding = this.powers.glide > 0 && !this.ground && this.jumpHeld && this.vy > 0 && !this.downHeld;
    if (this.gliding) this.vy = Math.min(this.vy, 70);
    const prevY = this.y;
    this.y += this.vy * dt;
    const wx = this.cam + PX;

    const wasGround = this.ground;
    this.ground = false;
    this.standOn = null;
    if (this.vy >= 0) {
      for (const b of this.blocks) {
        if (wx + PW - 2 < b.x || wx + 2 > b.x + b.w) continue;
        if (prevY <= b.top + 0.5 && this.y >= b.top) {
          this.y = b.top; this.vy = 0;
          if (!wasGround) { this.dust(wx, b.top); this.landT = 0.12; this.events.push('land'); if (this.roll) this.roll.dur = Math.min(this.roll.dur, this.roll.t + 0.07); }
          this.ground = true; this.jumps = 0;
        }
      }
      if (!this.ground) for (const p of this.plats) {
        if (wx + PW - 2 < p.x || wx + 2 > p.x + p.w) continue;
        if (prevY <= p.y + 0.5 && this.y >= p.y) {
          this.y = p.y; this.vy = 0;
          if (p.bounce) {
            this.vy = -BOUNCE; this.jumps = 1; this.jumpAt = this.clock; this.events.push('bounce'); this.burst(wx + 5, p.y, 8, 235); this.rolledThisAir = false; this.startRoll(0.5);
          } else {
            if (!wasGround) { this.dust(wx, p.y); this.landT = 0.12; this.events.push('land'); if (this.roll) this.roll.dur = Math.min(this.roll.dur, this.roll.t + 0.07); }
            this.ground = true; this.jumps = 0; this.standOn = p;
            if (p.crumble === -1) { p.crumble = 0; this.events.push('crack'); }
          }
          break;
        }
      }
    }
    if (wasGround && !this.ground && this.vy >= 0) { this.coyote = COYOTE; }
    if (!this.ground && this.coyote <= 0 && this.jumps === 0) this.jumps = 1; // walked off: one air jump left

    if (this.buffer > 0) {
      if (this.ground || this.coyote > 0) {
        this.vy = -JUMP; this.ground = false; this.jumps = 1; this.buffer = 0; this.coyote = 0; this.jumpAt = this.clock; this.dust(wx, this.y); this.events.push('jump');
      } else if (this.jumps < (this.powers.triple > 0 ? 3 : 2)) {
        const wait = DJ_GAP - (this.clock - this.jumpAt);
        if (wait <= 0) { this.vy = -DJUMP * (this.jumps === 2 ? 0.92 : 1); this.jumps++; this.jumpAt = this.clock; this.buffer = 0; this.events.push('double'); this.burst(wx + 5, this.y - 10, 12, 200); this.startRoll(0.42); }
        else this.buffer = Math.max(this.buffer, wait + 0.02); // hold the press until the second jump is allowed
      }
    }
    if (this.ground) { this.airT = 0; this.rolledThisAir = false; }
    else {
      this.airT += dt;
      if (this.airT > ROLL_AFTER && !this.rolledThisAir && this.vy < 120) this.startRoll(0.38);
    }
    if (this.roll) { this.roll.t += dt; if (this.roll.t >= this.roll.dur) this.roll = null; }
    this.landT = Math.max(0, this.landT - dt);
    this.sliding = this.ground && this.downHeld;

    // trail on the double jump
    this.trailTick += dt;
    if (this.roll && !this.ground && this.trailTick > 0.045) { this.trailTick = 0; this.trail.push({ y: this.y, a: 0.8, rot: this.rollAngle() }); }
    for (const tr of this.trail) tr.a -= dt * 4;
    this.trail = this.trail.filter((tr) => tr.a > 0).slice(-4);

    // walls: the front of a taller roof
    const h = this.sliding ? SLIDE : STAND;
    for (const p of this.plats) {
      if (p.bounce || p.thin || p.fallV) continue;
      if (wx + PW > p.x && wx < p.x + 4 && this.y > p.y + 5) return this.die('Hit a wall');
    }
    for (const b of this.blocks) {
      const inside = wx + PW - 2 > b.x && wx + 2 < b.x + b.w;
      if (wx + PW > b.x && wx < b.x + 4 && this.y - h < b.bottom && this.y > b.top + 5) return this.die('Hit a wall');
      if (inside && this.vy < 0 && this.y - h < b.bottom && prevY - h >= b.bottom - 0.5) return this.die('Hit the ceiling');
      if (b.glassIn && wx + PW >= b.x && this.y - h >= b.bottom - 3) { b.glassIn = false; this.shatter(b.x, b.bottom, b.floor); }
      if (b.glassOut && wx + PW >= b.x + b.w && this.y - h >= b.bottom - 3 && this.y <= b.floor + 1) { b.glassOut = false; this.shatter(b.x + b.w, b.bottom, b.floor); }
    }
    for (let i = 0; i < this.obs.length; i++) {
      const o = this.obs[i]!;
      if (o.kind === 'laser' && !this.laserOn(o)) continue;
      if (wx + PW - 2 > o.x + 1 && wx + 2 < o.x + o.w - 1 && this.y - h + 2 < o.y + o.h - 1 && this.y - 1 > o.y + 1) {
        if (this.invuln > 0) continue;
        if (this.powers.shield && o.kind !== 'laser') {
          this.powers.shield = false; this.invuln = 0.9; this.events.push('shield');
          this.burst(o.x + o.w / 2, o.y + o.h / 2, 18, 240); this.obs.splice(i, 1); i--; this.shake = 3;
          continue;
        }
        if (this.powers.shield && o.kind === 'laser') { this.powers.shield = false; this.invuln = 0.9; this.events.push('shield'); this.burst(wx + 5, this.y - 11, 18, 240); continue; }
        return this.die(o.kind === 'laser' ? 'Cut by a laser gate' : o.kind === 'drone' ? 'Tagged by a drone' : o.kind === 'bot' ? 'Grabbed by a security bot' : o.kind === 'cart' ? 'Run over by a cart' : o.kind === 'sign' ? 'Clotheslined by a sign' : 'Tripped over a crate');
      }
    }
    if (this.y > H + 30) return this.die('Fell');
    for (const pk of this.pickups) {
      if (pk.taken || Math.abs(pk.x - (wx + 5)) > 9 || pk.y < this.y - h - 7 || pk.y > this.y + 6) continue;
      pk.taken = true; this.events.push('power');
      if (pk.kind === 'triple') this.powers.triple = POWER_SECS.triple;
      if (pk.kind === 'glide') this.powers.glide = POWER_SECS.glide;
      if (pk.kind === 'shield') this.powers.shield = true;
      this.burst(pk.x, pk.y, 14, 230);
    }

    this.stepProps(dt, wx, h);

    // speed lines
    if (this.speed > 280 && Math.random() < (this.speed - 280) / 300) this.lines.push({ x: W, y: Math.random() * H * 0.8, len: 10 + Math.random() * 30 });
    for (const l of this.lines) l.x -= this.speed * 2.2 * dt;
    this.lines = this.lines.filter((l) => l.x + l.len > 0);

    // cull
    this.plats = this.plats.filter((p) => p.x + p.w > this.cam - 60);
    this.obs = this.obs.filter((o) => o.x + o.w > this.cam - 60);
    this.blocks = this.blocks.filter((b) => b.x + b.w > this.cam - 60);
    this.pickups = this.pickups.filter((pk) => !pk.taken && pk.x > this.cam - 40);
    this.plats = this.plats.filter((p) => p.y < H + 80);
    this.props = this.props.filter((pr) => pr.x + pr.w > this.cam - 80 || (pr.hit >= 0 && pr.hit < 3));
  }

  private ensure() { while (this.lastEnd() < this.cam + W * 2) this.gen(); }
  private keepGround() { this.y = RUNWAY; this.vy = 0; this.ground = true; }

  private die(reason: string) {
    this.events.push('die'); this.state = 'dead'; this.reason = reason; this.shake = 6; this.flash = 1; this.vy = -260; this.deadT = 0; this.roll = null;
    this.burst(this.cam + PX + 5, this.y - 10, 26, 252);
  }

  private laserOn(o: Ob) { return ((this.clock + o.phase) % o.amp) / o.amp < 0.5; }
  private shatter(x: number, top: number, floor: number) {
    this.events.push('glass');
    for (let i = 0; i < 26; i++) this.parts.push({ x: x + Math.random() * 3, y: top + Math.random() * (floor - top), vx: this.speed * 0.35 + Math.random() * 160, vy: -Math.random() * 170 + 20, life: 0.9, max: 0.9, l: 190 + Math.random() * 45, size: 1 + Math.round(Math.random()) });
  }

  private dust(wx: number, y: number) {
    for (let i = 0; i < 6; i++) this.parts.push({ x: wx + 5, y, vx: -40 - Math.random() * 80, vy: -Math.random() * 60, life: 0.4, max: 0.4, l: 150, size: 1 + Math.round(Math.random()) });
  }
  private burst(x: number, y: number, n: number, l: number) {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.parts.push({ x, y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, life: 0.5, max: 0.5, l, size: 2 }); }
  }
  private stepParts(dt: number) {
    for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
    this.parts = this.parts.filter((p) => p.life > 0);
  }
  private stepShips(dt: number, speed: number) {
    this.nextShip -= dt;
    if (this.nextShip <= 0) {
      this.nextShip = 3 + Math.random() * 6;
      const layer = Math.random() < 0.15 ? 4 : 1 + Math.floor(Math.random() * 3);
      const ltr = Math.random() < 0.35;
      const s = layer === 4 ? 2 : layer === 3 ? 1.4 : layer === 2 ? 1 : 0.7;
      this.ships.push({ layer, x: ltr ? -40 : W + 40, y: 18 + Math.random() * (layer === 4 ? 40 : 110), vx: (ltr ? 1 : -1) * (40 + Math.random() * 90) * s, s, t: 0 });
    }
    for (const sh of this.ships) { sh.x += (sh.vx - speed * PAR[sh.layer]! * 0.3) * dt; sh.t += dt; sh.y += Math.sin(sh.t * 1.5) * 4 * dt; }
    this.ships = this.ships.filter((sh) => sh.x > -80 && sh.x < W + 80);
  }

  // ── drawing (greys only) ──
  private f(l: number) { this.lum.fillStyle = this.grey[clamp(Math.round(l), 0, 255)]!; }
  private rect(x: number, y: number, w: number, h: number, l: number) { this.f(l); this.lum.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

  render(out: CanvasRenderingContext2D) {
    const c = this.lum;
    c.drawImage(this.sky, 0, 0);
    const cam = this.cam;
    // a big planet with a ring, barely moving
    const px = W * 0.78 - (cam * PAR[0]!) % (W * 2), py = 62;
    c.beginPath(); c.arc(px, py, 26, 0, Math.PI * 2); this.f(70); c.fill();
    c.beginPath(); c.arc(px - 6, py - 6, 20, 0, Math.PI * 2); this.f(84); c.fill();
    this.f(110); c.fillRect(px - 44, py + 2, 88, 2);

    this.skyline(1, 40, 60, 130, 44);
    this.drawShips(1);
    this.skyline(2, 62, 70, 160, 64);
    this.drawShips(2);
    this.skyline(3, 88, 90, 190, 96);
    this.drawShips(3);

    for (const l of this.lines) this.rect(l.x, l.y, l.len, 1, 120);

    for (const p of this.plats) this.drawPlat(p);
    for (const b of this.blocks) this.drawBlock(b);
    for (const pk of this.pickups) this.drawPickup(pk);
    for (const pr of this.props) this.drawProp(pr);
    for (const o of this.obs) this.drawOb(o);
    this.drawRunner();
    for (const p of this.parts) this.rect(p.x - cam, p.y, p.size, p.size, p.l * (0.5 + 0.5 * p.life / p.max));

    this.wires();
    this.drawShips(4);

    // colour
    this.buildLut();
    const img = c.getImageData(0, 0, W, H), d = img.data, lut = this.lut, acid = this.acidOn;
    for (let y = 0; y < H; y++) {
      const o = acid ? (y >> 3) * 768 : 0;
      for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
        const k = o + d[i]! * 3;
        d[i] = lut[k]!; d[i + 1] = lut[k + 1]!; d[i + 2] = lut[k + 2]!;
      }
    }
    const sx = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0, sy = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0;
    out.putImageData(img, sx, sy);
    if (this.flash > 0) { out.fillStyle = `rgba(255,255,255,${this.flash * 0.5})`; out.fillRect(0, 0, W, H); }
  }

  private acidOn = false;
  private buildLut() {
    const t = this.t;
    let i = 0; while (i < PALETTES.length - 1 && t >= PALETTES[i + 1]!.at) i++;
    const a = PALETTES[i]!, b = PALETTES[i + 1];
    const mix = b ? clamp((t - (b.at - BLEND)) / BLEND, 0, 1) : 0;
    const flash = 0.5 + 0.5 * Math.sin(this.clock * 10);
    const acid = a.stops === null || (b?.stops === null && mix > 0);
    this.acidOn = acid;
    const bands = acid ? BANDS : 1;
    const tmpA = new Float32Array(768), tmpB = new Float32Array(768);
    for (let band = 0; band < bands; band++) {
      if (a.stops) stopsLut(a.stops, a.hazard, tmpA, 0, flash * 0.35); else acidLut(this.clock, band, tmpA, 0, flash * 0.4);
      if (b && mix > 0) {
        if (b.stops) stopsLut(b.stops, b.hazard, tmpB, 0, flash * 0.35); else acidLut(this.clock, band, tmpB, 0, flash * 0.4);
        for (let k = 0; k < 768; k++) this.lut[band * 768 + k] = lerp(tmpA[k]!, tmpB[k]!, mix);
      } else this.lut.set(tmpA, band * 768);
      if (!acid) break;
    }
  }

  /** One background layer of towers, generated per 64px chunk from the seed. */
  private skyline(layer: number, l: number, minH: number, maxH: number, winL: number) {
    const c = this.lum, par = PAR[layer]!, off = this.cam * par, base = H - 40 - (3 - layer) * 14;
    const k0 = Math.floor(off / 64) - 1, k1 = Math.floor((off + W) / 64) + 1;
    for (let k = k0; k <= k1; k++) {
      const r = hashR(this.seed, k, layer);
      const n = 1 + Math.floor(r() * 2);
      for (let j = 0; j < n; j++) {
        const bw = 22 + Math.floor(r() * 30), bh = minH + Math.floor(r() * (maxH - minH));
        const bx = k * 64 + j * 30 + Math.floor(r() * 10) - off, by = base - bh;
        this.rect(bx, by, bw, bh + 40, l);
        if (r() < 0.5) this.rect(bx + bw / 2, by - 8 - r() * 10, 1, 18, l); // antenna
        if (r() < 0.4) { const blink = Math.sin(this.clock * 3 + k) > 0.3; this.rect(bx + bw / 2, by - 12, 1, 1, blink ? 240 : l + 30); }
        // windows
        const lit = r();
        for (let wy = by + 4; wy < base - 4; wy += 5 + layer) for (let wxx = bx + 3; wxx < bx + bw - 3; wxx += 4 + layer) {
          if (r() < 0.32 + lit * 0.3) { c.fillStyle = this.grey[winL + Math.floor(r() * 30)]!; c.fillRect(Math.round(wxx), Math.round(wy), layer === 3 ? 2 : 1, layer === 3 ? 2 : 1); }
        }
        // neon sign on the near layer
        if (layer === 3 && r() < 0.35) { const sy = by + 10 + r() * 30; this.rect(bx + 3, sy, bw - 6, 6, 205); this.rect(bx + 5, sy + 2, bw - 10, 2, 150); }
      }
    }
  }

  /** The front layer: sagging cables, lanterns over markets. In front of the runner, high up. */
  private wires() {
    const off = this.cam * PAR[4]!;
    const k0 = Math.floor(off / 140) - 1, k1 = Math.floor((off + W) / 140) + 1;
    for (let k = k0; k <= k1; k++) {
      const r = hashR(this.seed, k, 9);
      if (r() < 0.45) continue;
      const x0 = k * 140 - off, y0 = 6 + r() * 30, x1 = x0 + 140, y1 = 6 + r() * 30, sag = 10 + r() * 16;
      for (let x = 0; x <= 140; x += 2) {
        const t = x / 140, y = lerp(y0, y1, t) + Math.sin(t * Math.PI) * sag;
        this.rect(x0 + x, y, 2, 1, 22);
        if (x % 28 === 14 && r() < 0.6) { this.rect(x0 + x - 1, y + 1, 3, 4, 215); this.rect(x0 + x, y + 5, 1, 1, 160); }
      }
      void x1;
    }
  }

  private drawShips(layer: number) {
    for (const sh of this.ships) {
      if (sh.layer !== layer) continue;
      const s = sh.s, x = sh.x, y = sh.y, dir = sh.vx > 0 ? 1 : -1, l = layer === 4 ? 30 : 60 + layer * 20;
      this.rect(x - 12 * s, y, 24 * s, 4 * s, l);
      this.rect(x - 6 * s, y - 3 * s, 12 * s, 3 * s, l + 25);
      this.rect(x - 2 * s, y - 2 * s, 4 * s, 1 * s, 200);
      const fl = Math.sin(sh.t * 30) > 0 ? 245 : 190;
      this.rect(dir > 0 ? x - 14 * s : x + 12 * s, y + 1 * s, 2 * s, 2 * s, fl);
      for (let i = 1; i < 5; i++) this.rect(dir > 0 ? x - (14 + i * 4) * s : x + (12 + i * 4) * s, y + 1.5 * s, 3 * s, 1, Math.max(0, l + 60 - i * 15));
    }
  }

  private drawPlat(p: Plat) {
    const x = p.x - this.cam, c = this.lum;
    if (p.bounce) {
      for (let i = 0; i < p.w; i += 6) this.rect(x + i, p.y, 6, 4, (i / 6) % 2 ? 120 : 200);
      this.rect(x, p.y + 4, p.w, 1, 60);
      this.rect(x + 2, p.y + 4, 1, 20, 50); this.rect(x + p.w - 3, p.y + 4, 1, 20, 50);
      return;
    }
    if (p.thin) {
      // a hover platform: deck, rim light, and thrusters underneath
      this.rect(x, p.y, p.w, 4, 150); this.rect(x, p.y, p.w, 1, 205);
      const fl = Math.sin(this.clock * 24 + p.x) > 0 ? 235 : 180;
      this.rect(x + 6, p.y + 4, 6, 2, 70); this.rect(x + p.w - 12, p.y + 4, 6, 2, 70);
      this.rect(x + 8, p.y + 6, 2, 2 + (fl > 200 ? 2 : 0), fl); this.rect(x + p.w - 10, p.y + 6, 2, 2 + (fl > 200 ? 2 : 0), fl);
      return;
    }
    const jit = p.crumble !== undefined && p.crumble >= 0 && !p.fallV ? (Math.random() - 0.5) * 2 : 0;
    if (jit) { this.lum.save(); this.lum.translate(jit, 0); }
    const body = p.biome === 'roof' ? 30 : p.biome === 'alley' ? 42 : 48;
    this.rect(x, p.y, p.w, H - p.y + 10, body);
    this.rect(x, p.y, p.w, 2, p.biome === 'market' ? 175 : 160);
    this.rect(x, p.y + 2, p.w, 1, 70);
    if (p.biome === 'roof') {
      const r = hashR(this.seed, Math.floor(p.x), 7);
      for (let wy = p.y + 10; wy < H; wy += 10) for (let wxx = 6; wxx < p.w - 6; wxx += 9) { c.fillStyle = this.grey[r() < 0.3 ? 120 : 48]!; c.fillRect(Math.round(x + wxx), wy, 4, 5); }
      this.rect(x + 4, p.y - 4, 3, 4, 60); this.rect(x + p.w - 8, p.y - 4, 3, 4, 60); // ledge posts
    } else if (p.biome === 'alley') {
      for (let wxx = 0; wxx < p.w; wxx += 12) this.rect(x + wxx, p.y + 6 + ((wxx / 12) % 2) * 4, 8, 1, 60);
      this.rect(x, p.y + 20, p.w, 1, 34);
    } else {
      for (let wxx = 0; wxx < p.w; wxx += 16) this.rect(x + wxx, p.y + 3, 8, 3, (wxx / 16) % 2 ? 140 : 95);
    }
    if (p.crumble !== undefined) {
      // a weak roof: hairline cracks from the start, opening up once it is stood on
      const open = p.crumble >= 0 ? Math.min(1, p.crumble / 0.55) : 0;
      for (let i = 1; i < 4; i++) { const cx = x + (p.w * i) / 4; this.limb(cx, p.y, cx - 3 + i, p.y + 6 + open * 10, 1, 8); this.limb(cx - 3 + i, p.y + 6 + open * 10, cx + 2, p.y + 14 + open * 16, 1, 8); }
      this.rect(x, p.y, p.w, 1, 110);
    }
    if (jit) this.lum.restore();
  }

  private drawBlock(b: Block) {
    const x = b.x - this.cam;
    if (x > W + 10 || x + b.w < -10) return;
    // the passage: dark inside, lamps along the ceiling
    this.rect(x, b.bottom, b.w, b.floor - b.bottom, 16);
    for (let lx = 14; lx < b.w - 8; lx += 34) { this.rect(x + lx, b.bottom, 6, 2, 215); this.rect(x + lx - 2, b.bottom + 2, 10, 1, 60); }
    // the building above it
    this.rect(x, b.top, b.w, b.bottom - b.top, 34);
    this.rect(x, b.top, b.w, 2, 160); this.rect(x, b.top + 2, b.w, 1, 70);
    const r = hashR(this.seed, Math.floor(b.x), 11);
    for (let wy = b.top + 7; wy < b.bottom - 6; wy += 9) for (let wxx = 6; wxx < b.w - 6; wxx += 9) this.rect(x + wxx, wy, 4, 4, r() < 0.3 ? 118 : 46);
    this.rect(x, b.bottom - 3, b.w, 3, 22);
    // glass, or what is left of it
    for (const [gx, whole] of [[x, b.glassIn], [x + b.w - 2, b.glassOut]] as [number, boolean][]) {
      if (whole) {
        this.rect(gx, b.bottom, 2, b.floor - b.bottom, 128);
        for (let i = 4; i < b.floor - b.bottom - 2; i += 9) this.rect(gx, b.bottom + i, 2, 3, 205);
      } else {
        this.rect(gx, b.bottom, 2, 4, 150); this.rect(gx, b.bottom + 4, 1, 3, 150); this.rect(gx, b.floor - 3, 2, 3, 150);
      }
    }
  }

  private drawPickup(pk: Pickup) {
    if (pk.taken) return;
    const x = pk.x - this.cam, y = pk.y + Math.sin(this.clock * 3 + pk.x) * 2;
    if (x < -10 || x > W + 10) return;
    const spin = Math.abs(Math.cos(this.clock * 3.2 + pk.x)), hw = Math.max(1.5, spin * 6);
    // a glow ring, a spinning diamond, the mark on it
    const ring = 9 + Math.sin(this.clock * 6) * 1.5;
    for (let a = 0; a < 12; a++) { const t = (a / 12) * Math.PI * 2 + this.clock; this.rect(x + Math.cos(t) * ring, y + Math.sin(t) * ring, 1, 1, 200); }
    for (let dy = -7; dy <= 7; dy++) { const half = hw * (1 - Math.abs(dy) / 7.5); this.rect(x - half - 1, y + dy, half * 2 + 2, 1, 8); }
    for (let dy = -6; dy <= 6; dy++) { const half = hw * (1 - Math.abs(dy) / 7) - 0.5; if (half > 0) this.rect(x - half, y + dy, half * 2, 1, 238); }
    if (spin > 0.45) {
      if (pk.kind === 'triple') for (let i = -1; i <= 1; i++) this.rect(x - 0.5, y + i * 3 - 0.5, 1, 1, 10);
      if (pk.kind === 'shield') { this.rect(x - 2, y - 2, 4, 1, 10); this.rect(x - 2, y + 1, 4, 1, 10); this.rect(x - 2, y - 1, 1, 2, 10); this.rect(x + 1, y - 1, 1, 2, 10); }
      if (pk.kind === 'glide') { this.limb(x - 3, y + 1, x, y - 2, 1, 10); this.limb(x, y - 2, x + 3, y + 1, 1, 10); }
    }
  }

  private drawOb(o: Ob) {
    const x = o.x - this.cam;
    const hot = (bx: number, by: number, w: number, h: number) => { this.rect(bx - 1, by - 1, w + 2, h + 2, 4); this.rect(bx, by, w, h, 252); };
    if (o.kind === 'laser') {
      this.rect(x - 3, o.y - 6, 10, 6, 90); this.rect(x - 3, o.y + o.h - 1, 10, 3, 90);
      this.rect(x - 2, o.y - 5, 8, 1, 150);
      const on = this.laserOn(o), ph = ((this.clock + o.phase) % o.amp) / o.amp;
      if (on) { this.rect(x - 1, o.y, o.w + 2, o.h, 200); this.rect(x, o.y, o.w, o.h, 253); }
      else if (ph > 0.85) { if (Math.sin(this.clock * 60) > 0) this.rect(x + 1, o.y, 1, o.h, 150); } // about to fire
      return;
    }
    if (o.kind === 'crate') { hot(x, o.y, o.w, o.h); this.rect(x + 2, o.y + 2, o.w - 4, 1, 4); this.rect(x + 2, o.y + o.h - 3, o.w - 4, 1, 4); }
    if (o.kind === 'sign') {
      this.rect(x + 4, o.y - 40, 1, 40, 70); this.rect(x + o.w - 5, o.y - 40, 1, 40, 70);
      hot(x, o.y, o.w, o.h);
      for (let i = 4; i < o.h - 4; i += 6) this.rect(x + 3, o.y + i, o.w - 6, 2, 4);
    }
    if (o.kind === 'drone') {
      const sp = Math.sin(this.clock * 40) > 0;
      this.rect(x - 3, o.y - 2, sp ? 8 : 4, 1, 200); this.rect(x + o.w - (sp ? 5 : 1), o.y - 2, sp ? 8 : 4, 1, 200);
      hot(x, o.y, o.w, o.h);
      this.rect(x + 5, o.y + 3, 5, 3, 4); this.rect(x + 6, o.y + 4, 2, 1, Math.sin(this.clock * 8) > 0 ? 252 : 120);
      // the scanning beam
      this.rect(x + 6, o.y + o.h + 1, 3, 1, 180);
    }
    if (o.kind === 'cart') {
      hot(x, o.y, o.w, o.h - 3);
      const a = this.clock * 20;
      this.rect(x + 3, o.y + o.h - 3, 4, 3, Math.sin(a) > 0 ? 4 : 90); this.rect(x + o.w - 7, o.y + o.h - 3, 4, 3, Math.sin(a) > 0 ? 90 : 4);
    }
    if (o.kind === 'bot') {
      hot(x, o.y, o.w, o.h - 4);
      this.rect(x + 2, o.y + 3, o.w - 4, 2, 4);
      const st = Math.sin(this.clock * 12) > 0;
      this.rect(x + 1, o.y + o.h - 4, 2, 4, st ? 252 : 4); this.rect(x + o.w - 3, o.y + o.h - 4, 2, 4, st ? 4 : 252);
    }
  }

  private startRoll(dur: number) { this.roll = { t: 0, dur }; this.rolledThisAir = true; }
  /** One full forward turn, quick out of the gate and easing into the finish. */
  private rollAngle() {
    if (this.state === 'dead') return this.deadT * 9;
    if (!this.roll) return 0;
    const p = clamp(this.roll.t / this.roll.dur, 0, 1);
    return (1 - Math.pow(1 - p, 3)) * Math.PI * 2;
  }

  /** Pick the pose for what the runner is doing, and ease the current one toward it. */
  private animate(dt: number) {
    const run = this.state === 'run' || this.state === 'ready';
    const speed = this.state === 'ready' ? 120 : this.speed;
    if (run && this.ground) this.stride += dt * (9 + speed * 0.04); // quick feet: about 2.5 strides a second, 4 at top speed
    let target: Pose;
    if (this.state === 'dead') target = POSES.tuck;
    else if (this.sliding) target = POSES.slide;
    else if (this.roll) target = POSES.tuck;
    else if (!this.ground && this.state === 'run') target = this.vy < -60 ? POSES.rise : POSES.fall;
    else target = runPose(this.stride);
    const k = 1 - Math.exp(-dt * (this.roll ? 30 : 20));
    const cur = this.pose as unknown as Record<string, number>, tg = target as unknown as Record<string, number>;
    for (const key in tg) cur[key] = lerp(cur[key]!, tg[key]!, k);
    if (this.landT > 0) this.pose.crouch = Math.max(this.pose.crouch, this.landT / 0.12);
    this.stepScarf(dt, speed);
  }

  /** The joints, in pixels, relative to the feet. Angles are from straight down, positive forward. */
  private skeleton(rot: number) {
    const P = this.pose, crouch = P.crouch;
    const T = 8.5, TH = 7, SH = 7, UA = 5, FA = 4.5;
    const hip = { x: 0, y: -13.5 + crouch * 3.5 };
    const leg = (th: number, kn: number) => {
      const knee = { x: hip.x + Math.sin(th) * TH, y: hip.y + Math.cos(th) * TH };
      const s2 = th - kn;
      return { knee, foot: { x: knee.x + Math.sin(s2) * SH, y: knee.y + Math.cos(s2) * SH } };
    };
    const lF = leg(P.thF, P.knF + crouch * 0.9), lB = leg(P.thB, P.knB + crouch * 0.9);
    // planted: the lowest foot sits on the ground
    if (this.ground && !this.roll && this.state !== 'dead') {
      const drop = -Math.max(lF.foot.y, lB.foot.y);
      for (const q of [hip, lF.knee, lF.foot, lB.knee, lB.foot]) q.y += drop;
    }
    const neck = { x: hip.x + Math.sin(P.lean) * T, y: hip.y - Math.cos(P.lean) * T };
    const sh = { x: neck.x - Math.sin(P.lean) * 1.2, y: neck.y + Math.cos(P.lean) * 1.2 };
    const arm = (a: number, e: number) => {
      const elbow = { x: sh.x + Math.sin(a + P.lean * 0.4) * UA, y: sh.y + Math.cos(a + P.lean * 0.4) * UA };
      const f2 = a + P.lean * 0.4 + e;
      return { elbow, hand: { x: elbow.x + Math.sin(f2) * FA, y: elbow.y + Math.cos(f2) * FA } };
    };
    const aF = arm(P.shF, P.elF), aB = arm(P.shB, P.elB);
    const head = { x: neck.x + Math.sin(P.lean) * 3.2, y: neck.y - Math.cos(P.lean) * 3.2 };
    const pts = { hip, neck, sh, head, kF: lF.knee, fF: lF.foot, kB: lB.knee, fB: lB.foot, eF: aF.elbow, hF: aF.hand, eB: aB.elbow, hB: aB.hand };
    if (rot) {
      const cx = 0, cy = -11, c = Math.cos(rot), sn = Math.sin(rot);
      for (const q of Object.values(pts)) { const dx = q.x - cx, dy = q.y - cy; q.x = cx + dx * c - dy * sn; q.y = cy + dx * sn + dy * c; }
    }
    return pts;
  }

  /** A limb as a run of small squares: crisp at this size, with no blocky corners. */
  private limb(x0: number, y0: number, x1: number, y1: number, w: number, l: number) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    this.f(l);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      this.lum.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w);
    }
  }
  private disc(x: number, y: number, r: number, l: number) {
    this.f(l);
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      this.lum.fillRect(Math.round(x - half), Math.round(y + dy), Math.max(1, Math.round(half * 2)), 1);
    }
  }

  private drawRunner() {
    // the roll's motion arc: a fading sweep behind the spin, instead of ghost copies
    const rot = this.rollAngle();
    if (this.roll && rot > 0.3) {
      for (let i = 0; i < 14; i++) {
        const a = rot - 0.25 - i * 0.16;
        if (a < 0) break;
        const r = 10 - i * 0.2;
        this.rect(PX + 5 + Math.sin(a) * r, this.y - 11 - Math.cos(a) * r, 1, 1, 225 - i * 12);
      }
    }
    this.drawScarf();
    this.figure(PX + 5, this.y, this.rollAngle(), false, 1);
    if (this.gliding) {
      // a little canopy overhead, lines down to the hands
      const cx = PX + 5, cy = this.y - 34;
      for (let i = -12; i <= 12; i++) this.rect(cx + i, cy + (i * i) / 30, 1, 2, 8);
      for (let i = -11; i <= 11; i++) this.rect(cx + i, cy + (i * i) / 30, 1, 1, 225);
      this.limb(cx - 11, cy + 4, cx - 1, this.y - 16, 1, 120); this.limb(cx + 11, cy + 4, cx + 3, this.y - 16, 1, 120);
    }
    if (this.powers.shield || this.invuln > 0) {
      if (this.invuln > 0 && Math.sin(this.clock * 40) < 0) return;
      const r = 15 + Math.sin(this.clock * 5) * 0.8;
      for (let a = 0; a < 40; a++) { const t = (a / 40) * Math.PI * 2; this.rect(PX + 5 + Math.cos(t) * r, this.y - 11 + Math.sin(t) * r, 1, 1, a % 4 === 0 ? 235 : 175); }
    }
  }

  /** The runner: hooded, scarfed, leaning into it, arms swept back. Back limbs darker for depth. */
  private figure(x: number, y: number, rot: number, ghost: boolean, a: number) {
    const s = this.skeleton(rot);
    const X = (q: { x: number }) => x + q.x, Y = (q: { y: number }) => y + q.y;
    const body = ghost ? 50 + a * 60 : 205, dark = ghost ? body : 150, pants = ghost ? body : 175, ol = ghost ? Math.max(0, body - 70) : 8;
    const seg = (p: { x: number; y: number }, q: { x: number; y: number }, w: number, l: number) => this.limb(X(p), Y(p), X(q), Y(q), w, l);
    if (!ghost) {
      // outline pass
      seg(s.hip, s.kB, 4, ol); seg(s.kB, s.fB, 4, ol); seg(s.sh, s.eB, 4, ol); seg(s.eB, s.hB, 4, ol);
      seg(s.hip, s.neck, 5, ol); seg(s.hip, s.kF, 4, ol); seg(s.kF, s.fF, 4, ol); seg(s.sh, s.eF, 4, ol); seg(s.eF, s.hF, 4, ol);
      this.disc(X(s.head), Y(s.head), 3.9, ol);
    }
    // back leg and arm
    seg(s.hip, s.kB, 2, dark); seg(s.kB, s.fB, 2, dark); seg(s.sh, s.eB, 2, dark); seg(s.eB, s.hB, 2, dark);
    // torso (hoodie), front leg, front arm
    seg(s.hip, s.neck, 3, body);
    seg(s.hip, s.kF, 2, pants); seg(s.kF, s.fF, 2, pants);
    seg(s.sh, s.eF, 2, body); seg(s.eF, s.hF, 2, body);
    // head in a hood, a lit visor looking ahead
    this.disc(X(s.head), Y(s.head), 2.9, ghost ? body : 214);
    if (!ghost) {
      const lean = this.pose.lean + rot;
      const fx = Math.cos(lean), fy = Math.sin(lean);
      this.limb(X(s.head) + fx * 1.2, Y(s.head) + fy * 1.2, X(s.head) + fx * 3, Y(s.head) + fy * 3 - 0.5, 1, 246);
      // the hood, draped down the back of the head
      this.limb(X(s.head) - fx * 2.2, Y(s.head) - fy * 2.2 - 1.5, X(s.head) - fx * 3.4, Y(s.head) - fy * 3.4 + 1.5, 2, 188);
      // shoes
      this.limb(X(s.fF), Y(s.fF), X(s.fF) + 2, Y(s.fF), 2, 235); this.limb(X(s.fB), Y(s.fB), X(s.fB) + 2, Y(s.fB), 2, 120);
    }
  }

  /** The scarf: a short rope that trails in the wind, whips through rolls. Screen space. */
  private stepScarf(dt: number, speed: number) {
    const s = this.skeleton(this.rollAngle());
    const ax = PX + 5 + s.neck.x - 0.5, ay = this.y + s.neck.y + 0.5;
    const n0 = this.scarf[0]!; n0.x = ax; n0.y = ay; n0.px = ax; n0.py = ay;
    const wind = -(80 + speed * 0.9), sub = dt * dt;
    for (let i = 1; i < this.scarf.length; i++) {
      const q = this.scarf[i]!;
      const vx = (q.x - q.px) * 0.9, vy = (q.y - q.py) * 0.9;
      q.px = q.x; q.py = q.y;
      q.x += vx + wind * sub * 12; q.y += vy + (180 + Math.sin(this.clock * 9 + i) * 140) * sub * 6;
    }
    for (let it = 0; it < 3; it++) for (let i = 1; i < this.scarf.length; i++) {
      const a = this.scarf[i - 1]!, b = this.scarf[i]!, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, k = (d - 2.2) / d;
      b.x -= dx * k; b.y -= dy * k;
    }
  }
  private drawScarf() {
    for (let i = 1; i < this.scarf.length; i++) {
      const a = this.scarf[i - 1]!, b = this.scarf[i]!;
      this.limb(a.x, a.y, b.x, b.y, i < 4 ? 3 : 2, 8);
    }
    for (let i = 1; i < this.scarf.length; i++) {
      const a = this.scarf[i - 1]!, b = this.scarf[i]!;
      this.limb(a.x, a.y, b.x, b.y, i < 4 ? 2 : 1, 232);
    }
  }

  // ── props: things to brush through ──
  private scatterProps(p: Plat) {
    const r = this.r;
    const kinds: PropKind[] = p.biome === 'roof' ? ['birds', 'birds', 'laundry', 'cans'] : p.biome === 'alley' ? ['puddle', 'cans', 'papers', 'laundry', 'puddle'] : ['chimes', 'chimes', 'cans', 'papers', 'puddle'];
    let x = p.x + 40 + r() * 80;
    while (x < p.x + p.w - 50) {
      if (r() < 0.55 && !this.obs.some((o) => Math.abs(o.x - x) < 46)) {
        const kind = kinds[Math.floor(r() * kinds.length)]!;
        const w = kind === 'laundry' ? 44 : kind === 'puddle' ? 22 : kind === 'chimes' ? 30 : 14;
        this.props.push({ kind, x, y: p.y, w, hit: -1, seed: Math.floor(r() * 1e9), bits: [] });
      }
      x += 90 + r() * 160;
    }
  }

  private stepProps(dt: number, wx: number, h: number) {
    for (const pr of this.props) {
      if (pr.hit >= 0) {
        pr.hit += dt;
        for (const b of pr.bits) {
          b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt;
          if (pr.kind === 'papers') { b.vy += 60 * dt; b.vx *= 1 - dt * 1.5; b.x += Math.sin(this.clock * 6 + b.a) * 20 * dt; }
          else if (pr.kind === 'birds') { b.vy -= 40 * dt; }
          else { b.vy += 700 * dt; if (pr.kind === 'cans' && b.y > pr.y - 2 && b.vy > 0) { b.y = pr.y - 2; b.vy *= -0.4; b.vx *= 0.7; b.va *= 0.6; } }
        }
        continue;
      }
      const near = pr.kind === 'birds' ? wx + PW > pr.x - 46 : wx + PW > pr.x && wx < pr.x + pr.w;
      if (!near || wx > pr.x + pr.w + 20) continue;
      // the part of the prop the runner's body actually passes through
      const top = this.y - h, bot = this.y;
      const zone: [number, number] = pr.kind === 'laundry' ? [pr.y - 34, pr.y - 18] : pr.kind === 'chimes' ? [pr.y - 34, pr.y - 22] : pr.kind === 'birds' ? [pr.y - 80, pr.y] : [pr.y - 7, pr.y + 1];
      if (bot < zone[0] || top > zone[1]) continue;
      this.trigger(pr);
    }
  }

  private trigger(pr: Prop) {
    pr.hit = 0;
    this.events.push('prop');
    const r = rng(pr.seed), v = this.speed;
    if (pr.kind === 'birds') for (let i = 0; i < 3; i++) pr.bits.push({ x: pr.x + i * 5, y: pr.y - 2, vx: 30 + r() * 70, vy: -60 - r() * 50, a: r() * 6, va: 0 });
    if (pr.kind === 'cans') for (let i = 0; i < 3; i++) pr.bits.push({ x: pr.x + i * 4, y: pr.y - 3, vx: v * (0.5 + r() * 0.5), vy: -110 - r() * 120, a: 0, va: 14 + r() * 16 });
    if (pr.kind === 'papers') for (let i = 0; i < 6; i++) pr.bits.push({ x: pr.x + r() * 10, y: pr.y - 2, vx: v * 0.3 + r() * 60, vy: -80 - r() * 90, a: r() * 6, va: 4 + r() * 6 });
    if (pr.kind === 'puddle') for (let i = 0; i < 10; i++) pr.bits.push({ x: pr.x + 4 + r() * 14, y: pr.y - 1, vx: v * 0.2 + (r() - 0.3) * 90, vy: -90 - r() * 120, a: 0, va: 0 });
    if (pr.kind === 'laundry') pr.bits.push({ x: this.cam + PX + 2, y: pr.y - 26, vx: v * 0.85, vy: -50, a: 0, va: 9 });
    if (pr.kind === 'chimes') for (let i = 0; i < 5; i++) pr.bits.push({ x: pr.x + r() * pr.w, y: pr.y - 30, vx: (r() - 0.5) * 60, vy: -40 - r() * 60, a: 0, va: 0 });
  }

  private drawProp(pr: Prop) {
    const x = pr.x - this.cam, y = pr.y, h = pr.hit, cam = this.cam;
    if (x > W + 60 || x < -120) return;
    if (pr.kind === 'birds') {
      if (h < 0) {
        for (let i = 0; i < 3; i++) { const bob = Math.sin(this.clock * 3 + i * 2) > 0.7 ? 1 : 0; this.rect(x + i * 5, y - 3 - bob, 3, 2, 175); this.rect(x + i * 5 + 2, y - 4 - bob, 1, 1, 200); }
      } else for (const b of pr.bits) {
        const up = Math.sin(this.clock * 30 + b.a) > 0;
        this.rect(b.x - cam, b.y, 2, 2, 175); this.rect(b.x - cam - 2, b.y + (up ? -2 : 1), 2, 1, 160); this.rect(b.x - cam + 2, b.y + (up ? -2 : 1), 2, 1, 160);
      }
    }
    if (pr.kind === 'laundry') {
      this.rect(x, y - 42, 1, 42, 70); this.rect(x + pr.w, y - 42, 1, 42, 70);
      const swing = h >= 0 ? Math.sin(h * 14) * Math.exp(-h * 2.5) * 6 : Math.sin(this.clock * 1.5) * 0.6;
      for (let i = 0; i <= pr.w; i += 2) this.rect(x + i, y - 40 + Math.sin((i / pr.w) * Math.PI) * 5, 2, 1, 40);
      const r = rng(pr.seed);
      for (let i = 0; i < 4; i++) {
        if (h >= 0 && i === 1) continue; // that one went with the runner
        const cx = x + 6 + i * 10, cy = y - 39 + Math.sin(((6 + i * 10) / pr.w) * Math.PI) * 5, l = 140 + Math.floor(r() * 60), ln = 9 + Math.floor(r() * 5);
        this.limb(cx, cy, cx + swing * (0.6 + i * 0.15), cy + ln, 5, l);
      }
      for (const b of pr.bits) { const sx = b.x - cam; this.limb(sx, b.y, sx + Math.cos(b.a) * 5, b.y + Math.sin(b.a) * 5 + 4, 4, 180); }
    }
    if (pr.kind === 'puddle') {
      this.rect(x, y - 1, pr.w, 2, 82); this.rect(x + 3, y - 1, pr.w - 8, 1, 130);
      if (h >= 0 && h < 0.8) { const rr = h * 30; this.rect(x + pr.w / 2 - rr, y - 1, 1, 1, 170); this.rect(x + pr.w / 2 + rr, y - 1, 1, 1, 170); }
      for (const b of pr.bits) if (b.y < y) this.rect(b.x - cam, b.y, 1, 2, 175);
    }
    if (pr.kind === 'cans') {
      if (h < 0) for (let i = 0; i < 3; i++) { this.rect(x + i * 4, y - 4, 3, 4, 135); this.rect(x + i * 4, y - 4, 3, 1, 190); }
      else for (const b of pr.bits) this.limb(b.x - cam - Math.cos(b.a) * 1.5, b.y - Math.sin(b.a) * 1.5, b.x - cam + Math.cos(b.a) * 1.5, b.y + Math.sin(b.a) * 1.5, 3, 150);
    }
    if (pr.kind === 'papers') {
      if (h < 0) { this.rect(x, y - 2, 6, 2, 165); this.rect(x + 7, y - 1, 4, 1, 150); }
      else for (const b of pr.bits) { const c = Math.cos(b.a); this.rect(b.x - cam, b.y, Math.max(1, Math.round(Math.abs(c) * 4)), 2, 180); }
    }
    if (pr.kind === 'chimes') {
      this.rect(x - 2, y - 44, pr.w + 4, 2, 60);
      for (let i = 0; i < 4; i++) {
        const sw = h >= 0 ? Math.sin(h * 16 + i) * Math.exp(-h * 2) * 5 : Math.sin(this.clock * 2 + i) * 0.8;
        const cx = x + 3 + i * 8, ln = 9 + (i % 2) * 4;
        this.limb(cx, y - 42, cx + sw, y - 42 + ln, 1, 120);
        this.limb(cx + sw, y - 42 + ln, cx + sw * 1.1, y - 39 + ln, 2, h >= 0 && h < 0.6 ? 230 : 200);
      }
      for (const b of pr.bits) if (h < 0.9) this.rect(b.x - cam, b.y, 1, 1, 225);
    }
  }
}

/** Key poses. Angles in radians from straight down, positive forward. */
const POSES: Record<'run' | 'rise' | 'fall' | 'tuck' | 'slide', Pose> = {
  run: { lean: 0.82, thF: 0.9, knF: 0.4, thB: -0.5, knB: 1.4, shF: -0.8, elF: 1.4, shB: 1.0, elB: 1.6, crouch: 0.15 },
  rise: { lean: 0.4, thF: 1.4, knF: 2.0, thB: 0.2, knB: 1.6, shF: 1.6, elF: 1.0, shB: -0.9, elB: 1.2, crouch: 0 },
  fall: { lean: 0.3, thF: 0.8, knF: 0.7, thB: -0.3, knB: 1.1, shF: 1.1, elF: 0.6, shB: -0.7, elB: 0.9, crouch: 0 },
  tuck: { lean: 0.9, thF: 2.1, knF: 2.5, thB: 1.8, knB: 2.4, shF: 1.2, elF: 1.4, shB: 0.9, elB: 1.5, crouch: 0.3 },
  slide: { lean: -0.85, thF: 1.45, knF: 0.15, thB: 1.0, knB: 2.1, shF: -2.1, elF: 0.2, shB: 0.6, elB: 1.2, crouch: 0.9 },
};
/**
 * The sprint: legs on opposite phases, driving the knee high and kicking the
 * heel up through the swing, straightening for the plant; elbows bent near a
 * right angle, pumping opposite the legs; leaning well into it, bobbing twice
 * a stride.
 */
function runPose(p: number): Pose {
  const leg = (q: number) => ({ th: 0.3 + 1.05 * Math.sin(q), kn: 0.15 + 1.95 * Math.max(0, Math.sin(q + 1.6)) });
  const arm = (q: number) => ({ sh: 0.1 + 1.15 * Math.sin(q), el: 1.35 + 0.45 * Math.max(0, Math.sin(q)) });
  const a = leg(p), b = leg(p + Math.PI);
  // each arm swings with the opposite leg
  const af = arm(p + Math.PI), ab = arm(p);
  return {
    lean: 0.82 + Math.cos(2 * p) * 0.05,
    thF: a.th, knF: a.kn, thB: b.th, knB: b.kn,
    shF: af.sh, elF: af.el, shB: ab.sh, elB: ab.el,
    crouch: 0.15 + 0.15 * Math.cos(2 * p),
  };
}

/** Parallax per layer: 0 the planet, 1-3 the towers, 4 the cables in front. */
const PAR = [0.02, 0.12, 0.28, 0.5, 0.85];
