import { W, H, KINDS, COLORS, type Snapshot, type GameEvent, type EnemyKind } from './engine';
import { shipById } from './ships';
import { QUIET, type Vibe } from './vibe';

/**
 * Drawing. Everything renders from a Snapshot, so the host, a guest and a
 * replay all go through one path. Glow comes from additive blending and a
 * wide faint stroke under each thin bright one, not shadowBlur, which is
 * far too slow for a few hundred shapes a frame.
 */

export interface Who { color: string; ship: string; name: string }

// ── The grid: a spring mesh that bends under gravity wells and ripples under fire ──
const GS = 40, GX = W / GS + 1, GY = H / GS + 1;
export class Grid {
  private dx = new Float32Array(GX * GY); private dy = new Float32Array(GX * GY);
  private vx = new Float32Array(GX * GY); private vy = new Float32Array(GX * GY);
  /** A push outward (positive) or inward (negative) at a point. */
  impulse(x: number, y: number, strength: number, radius: number) {
    const x0 = Math.max(0, Math.floor((x - radius) / GS)), x1 = Math.min(GX - 1, Math.ceil((x + radius) / GS));
    const y0 = Math.max(0, Math.floor((y - radius) / GS)), y1 = Math.min(GY - 1, Math.ceil((y + radius) / GS));
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const px = i * GS, py = j * GS, ddx = px - x, ddy = py - y, d = Math.hypot(ddx, ddy) || 1;
      if (d > radius) continue;
      const f = strength * (1 - d / radius), k = j * GX + i;
      this.vx[k]! += (ddx / d) * f; this.vy[k]! += (ddy / d) * f;
    }
  }
  update(dt: number, wells: { x: number; y: number; r: number }[]) {
    for (const w of wells) this.impulse(w.x, w.y, -900 * dt * (w.r / 28), 260 + w.r * 3);
    const k1 = 60, damp = Math.pow(0.02, dt);
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
      const k = j * GX + i;
      if (i === 0 || j === 0 || i === GX - 1 || j === GY - 1) { this.dx[k] = this.dy[k] = 0; continue; }
      // spring home, plus a little of the neighbours' shape so ripples travel
      const nx = (this.dx[k - 1]! + this.dx[k + 1]! + this.dx[k - GX]! + this.dx[k + GX]!) / 4;
      const ny = (this.dy[k - 1]! + this.dy[k + 1]! + this.dy[k - GX]! + this.dy[k + GX]!) / 4;
      this.vx[k] = (this.vx[k]! + (-this.dx[k]! * k1 + (nx - this.dx[k]!) * 40) * dt) * damp;
      this.vy[k] = (this.vy[k]! + (-this.dy[k]! * k1 + (ny - this.dy[k]!) * 40) * dt) * damp;
      this.dx[k] = Math.max(-GS * 1.6, Math.min(GS * 1.6, this.dx[k]! + this.vx[k]! * dt));
      this.dy[k] = Math.max(-GS * 1.6, Math.min(GS * 1.6, this.dy[k]! + this.vy[k]! * dt));
    }
  }
  /** `col(alpha)` gives the stroke; the default is the arena's blue. */
  draw(g: CanvasRenderingContext2D, col: (a: number) => string = (a) => `rgba(77,124,255,${a})`) {
    const px = (i: number, j: number) => i * GS + this.dx[j * GX + i]!, py = (i: number, j: number) => j * GS + this.dy[j * GX + i]!;
    for (const [w, a] of [[3, 0.1], [1, 0.42]] as const) {
      g.lineWidth = w; g.strokeStyle = col(a);
      g.beginPath();
      for (let j = 0; j < GY; j++) { g.moveTo(px(0, j), py(0, j)); for (let i = 1; i < GX; i++) g.lineTo(px(i, j), py(i, j)); }
      for (let i = 0; i < GX; i++) { g.moveTo(px(i, 0), py(i, 0)); for (let j = 1; j < GY; j++) g.lineTo(px(i, j), py(i, j)); }
      g.stroke();
    }
  }
}

// ── Sparks ──
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string }
export class Fx {
  sparks: Spark[] = [];
  burst(x: number, y: number, c: string, n: number, speed = 420) {
    for (let i = 0; i < n && this.sparks.length < 4000; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.2 + Math.random() * 0.9), life = 0.4 + Math.random() * 0.7;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, c });
    }
  }
  ring(x: number, y: number, c: string) { for (let i = 0; i < 160; i++) { const a = (i / 160) * Math.PI * 2; this.sparks.push({ x, y, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, life: 0.9, max: 0.9, c }); } }
  update(dt: number) {
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.93; s.vy *= 0.93; s.life -= dt; if (s.x < 0 || s.x > W) s.vx *= -1; if (s.y < 0 || s.y > H) s.vy *= -1; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }
  draw(g: CanvasRenderingContext2D) {
    g.lineWidth = 2;
    for (const s of this.sparks) {
      g.globalAlpha = Math.min(1, (s.life / s.max) * 1.4); g.strokeStyle = s.c;
      g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - s.vx * 0.025, s.y - s.vy * 0.025); g.stroke();
    }
    g.globalAlpha = 1;
  }
}

/** Turn a frame's events into sparks and grid ripples. */
export function react(evs: GameEvent[], fx: Fx, grid: Grid, who: Record<string, Who>) {
  for (const e of evs) {
    if (e.k === 'boom') { fx.burst(e.x, e.y, e.c, e.n); grid.impulse(e.x, e.y, 30 + e.n * 4, 60 + e.n * 2); }
    else if (e.k === 'bomb') { fx.ring(e.x, e.y, '#7df9ff'); grid.impulse(e.x, e.y, 1400, 700); }
    else if (e.k === 'die') { fx.ring(e.x, e.y, who[e.pid]?.color ?? '#f4b728'); grid.impulse(e.x, e.y, 900, 500); }
    else if (e.k === 'shot') grid.impulse(e.x, e.y, 8, 50);
  }
}

// ── Shapes ──
function glow(g: CanvasRenderingContext2D, c: string, w: number, path: () => void) {
  g.strokeStyle = c; g.lineJoin = 'round'; g.lineCap = 'round';
  g.globalAlpha = 0.22; g.lineWidth = w * 3.2; path();
  g.globalAlpha = 1; g.lineWidth = w; path();
}
/** Ships get a wider halo and a white-hot core, so they read above everything else. */
function shipGlow(g: CanvasRenderingContext2D, c: string, w: number, path: () => void) {
  g.strokeStyle = c; g.lineJoin = 'round'; g.lineCap = 'round';
  g.globalAlpha = 0.1; g.lineWidth = w * 6; path();
  g.globalAlpha = 0.3; g.lineWidth = w * 2.8; path();
  g.globalAlpha = 1; g.lineWidth = w; path();
  g.strokeStyle = '#fff'; g.globalAlpha = 0.55; g.lineWidth = w * 0.4; path();
  g.globalAlpha = 1;
}

// ── Trip trails: each ship leaves a drifting, colour-turning ribbon ──
const TRAIL_S = 2.2;
const trails = new Map<string, { x: number; y: number; t: number }[]>();
function trail(g: CanvasRenderingContext2D, id: string, x: number, y: number, t: number, vibe: Vibe, draw: boolean) {
  let q = trails.get(id); if (!q) trails.set(id, (q = []));
  const last = q[q.length - 1];
  if (!last || t - last.t > 1 / 60) q.push({ x, y, t });
  while (q.length && t - q[0]!.t > TRAIL_S) q.shift();
  if (!draw || q.length < 3) return;
  g.lineCap = 'butt';
  for (const [wide, a0] of [[1.8, 0.08], [1, 0.17], [0.3, 0.5]] as const) {
    for (let i = 1; i < q.length; i++) {
      const p0 = q[i - 1]!, p1 = q[i]!, age = (t - p1.t) / TRAIL_S, life = 1 - age;
      // older points sway sideways more, like ink loosening in water
      const sway = (p: { x: number; y: number; t: number }) => { const a = (t - p.t) / TRAIL_S; return [p.x + Math.sin(p.t * 3 + t * 1.1) * a ** 1.5 * 80, p.y + Math.cos(p.t * 2.6 + t * 0.9) * a ** 1.5 * 80]; };
      const [ax, ay] = sway(p0), [bx, by] = sway(p1);
      g.globalAlpha = life ** 1.2 * a0 * (0.7 + vibe.level * 0.6);
      g.strokeStyle = `hsl(${(vibe.hue + age * 240) % 360}, 95%, ${62 + vibe.beat * 18}%)`;
      g.lineWidth = (6 + age * 26 + vibe.bass * 10) * wide;
      g.beginPath(); g.moveTo(ax!, ay!); g.lineTo(bx!, by!); g.stroke();
    }
  }
  g.globalAlpha = 1; g.lineCap = 'round';
}

function enemy(g: CanvasRenderingContext2D, k: EnemyKind, x: number, y: number, a: number, r: number, t: number, trail?: number[]) {
  const c = COLORS[k];
  if (k === 'reuse' && trail) glow(g, c, 2, () => { for (let i = 2; i < trail.length; i += 2) { g.beginPath(); g.arc(trail[i]!, trail[i + 1]!, Math.max(4, 9 - i * 0.12), 0, 7); g.stroke(); } });
  g.save(); g.translate(x, y); g.rotate(a); g.scale(1.15, 1.15);
  glow(g, c, 2.2, () => {
    g.beginPath();
    if (k === 'tracker') for (let i = 0; i < 4; i++) { const q = (i * Math.PI) / 2; g.moveTo(0, 0); g.lineTo(Math.cos(q) * r, Math.sin(q) * r); g.lineTo(Math.cos(q + 0.6) * r * 0.7, Math.sin(q + 0.6) * r * 0.7); g.closePath(); }
    else if (k === 'dust') { g.moveTo(r, 0); g.lineTo(0, -r * 0.65); g.lineTo(-r, 0); g.lineTo(0, r * 0.65); g.closePath(); }
    else if (k === 'doxxer') { g.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); g.moveTo(-r * 0.8, -r * 0.8); g.lineTo(r * 0.8, r * 0.8); g.moveTo(r * 0.8, -r * 0.8); g.lineTo(-r * 0.8, r * 0.8); }
    else if (k === 'shard') { g.moveTo(r, 0); g.lineTo(-r * 0.6, -r * 0.6); g.lineTo(-r * 0.3, 0); g.lineTo(-r * 0.6, r * 0.6); g.closePath(); }
    else if (k === 'reuse') { g.arc(0, 0, r, 0, 7); g.moveTo(r, 0); g.lineTo(r + 7, 0); }
    else if (k === 'analyst') { for (let i = 0; i < 6; i++) { const q = (i * Math.PI) / 3; i ? g.lineTo(Math.cos(q) * r, Math.sin(q) * r) : g.moveTo(Math.cos(q) * r, Math.sin(q) * r); } g.closePath(); g.moveTo(r * 0.45, 0); g.arc(0, 0, r * 0.45, 0, 7); }
    else if (k === 'deanon') for (let i = 0; i < 3; i++) { const rr = r * (1 - i * 0.28) * (1 + Math.sin(t * 5 + i) * 0.04); g.moveTo(rr, 0); g.arc(0, 0, rr, 0, 7); }
    g.stroke();
  });
  g.restore();
}

/**
 * The pulse round a ship, by state. Shielded (respawn, turnstile) is cyan;
 * the multiplier tiers that boost firepower go verdigris, violet, rose; at
 * x100 it runs through every colour.
 */
function pulseColor(own: string, mult: number, shielded: boolean, t: number) {
  if (shielded) return '#7df9ff';
  if (mult >= 100) return `hsl(${(t * 220) % 360}, 95%, 66%)`;
  if (mult >= 50) return '#ff6f9a';
  if (mult >= 25) return '#9b7bff';
  if (mult >= 10) return '#3fcfa9';
  return own;
}

/** One frame. `t` is wall time, for the things that spin and pulse on their own. */
export function drawFrame(g: CanvasRenderingContext2D, s: Snapshot, who: Record<string, Who>, grid: Grid, fx: Fx, t: number, cw: number, ch: number, vibe: Vibe = QUIET, echo?: HTMLCanvasElement) {
  const k = Math.min(cw / W, ch / H), ox = (cw - W * k) / 2, oy = (ch - H * k) / 2;
  const live = vibe.mode !== 'off' && !vibe.silent, trip = live && vibe.mode === 'trip';
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#03030a'; g.fillRect(0, 0, cw, ch);
  // Trip: the last frame again, faint, a little bigger and turned with the bass: a
  // tunnel of echoes. One faded copy per frame, so it can never pile up past ~1.3x.
  if (trip && echo && echo.width === cw && echo.height === ch) {
    const z = 1.012 + vibe.bass * 0.03, rot = (vibe.beat - 0.5) * 0.012;
    g.save(); g.globalAlpha = 0.18 + vibe.level * 0.22;
    g.translate(cw / 2, ch / 2); g.rotate(rot); g.scale(z, z); g.translate(-cw / 2, -ch / 2);
    g.drawImage(echo, 0, 0); g.restore();
  }
  g.setTransform(k, 0, 0, k, ox, oy);
  if (live) {
    // a colour wash behind everything, breathing with the bass
    const wash = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
    wash.addColorStop(0, `hsla(${vibe.hue}, 80%, 24%, ${(trip ? 0.16 : 0.08) + vibe.bass * (trip ? 0.3 : 0.24)})`);
    wash.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    g.fillStyle = wash; g.fillRect(0, 0, W, H);
  }
  g.globalCompositeOperation = 'lighter';
  if (live) {
    const lift = Math.min(1.8, 0.8 + vibe.level * 0.7 + vibe.beat * 0.6);
    if (trip) {
      // chromatic split: the grid again, offset red one way and cyan the other
      const d = 2 + vibe.bass * 12;
      g.save(); g.translate(d, 0); grid.draw(g, (a) => `hsla(${(vibe.hue + 120) % 360}, 95%, 60%, ${a * 0.3})`); g.restore();
      g.save(); g.translate(-d, 0); grid.draw(g, (a) => `hsla(${(vibe.hue + 240) % 360}, 95%, 60%, ${a * 0.3})`); g.restore();
    }
    grid.draw(g, (a) => `hsla(${vibe.hue}, 85%, 62%, ${Math.min(1, a * lift)})`);
  } else grid.draw(g);
  // the arena's edge: gold, or in Trip the colour opposite the grid, thickening with the treble
  const edge = trip ? `hsl(${(vibe.hue + 180) % 360}, 90%, 62%)` : '#f4b728';
  g.globalAlpha = 0.25 + (live ? vibe.beat * 0.4 : 0); g.lineWidth = 8 + (live ? vibe.high * 14 : 0); g.strokeStyle = edge; g.strokeRect(4, 4, W - 8, H - 8);
  g.globalAlpha = 1; g.lineWidth = 2.5; g.strokeRect(4, 4, W - 8, H - 8);
  // under each ship: a dark pool, so the grid falls away round it and the ship reads
  g.globalCompositeOperation = 'source-over';
  for (const p of s.p) {
    const [, x, y, , alive] = p as [string, number, number, number, number];
    if (!alive) continue;
    const pool = g.createRadialGradient(x, y, 0, x, y, 150);
    pool.addColorStop(0, 'rgba(2,2,8,0.82)'); pool.addColorStop(0.55, 'rgba(2,2,8,0.45)'); pool.addColorStop(1, 'rgba(2,2,8,0)');
    g.fillStyle = pool; g.fillRect(x - 150, y - 150, 300, 300);
  }
  g.globalCompositeOperation = 'lighter';
  // the pulse: a steady ring and rings rolling outward, faster as the multiplier climbs;
  // with music on, every kick sends one out too
  for (const p of s.p) {
    const [id, x, y, , alive, inv, , pm] = p as [string, number, number, number, number, number, number, number];
    if (!alive) continue;
    const mult = Math.max(Number(pm) || 1, s.mult || 1);
    trail(g, id, x, y, t, vibe, trip);
    const c = pulseColor(who[id]?.color ?? '#f4b728', mult, Boolean(inv), t);
    const rate = 0.9 + Math.min(mult, 100) / 100 * 1.6;
    glow(g, c, 1.6, () => { g.beginPath(); g.arc(x, y, 27 + Math.sin(t * rate * 6.28) * 2.5, 0, 7); g.stroke(); });
    for (let i = 0; i < 2; i++) {
      const ph = (t * rate + i / 2) % 1;
      g.globalAlpha = (1 - ph) * 0.55; g.lineWidth = 2; g.strokeStyle = c;
      g.beginPath(); g.arc(x, y, 28 + ph * 74, 0, 7); g.stroke();
    }
    if (live && vibe.beat > 0.02) {
      g.globalAlpha = vibe.beat * 0.85; g.lineWidth = 3 + vibe.bass * 4; g.strokeStyle = c;
      g.beginPath(); g.arc(x, y, 30 + (1 - vibe.beat) * 120, 0, 7); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // notes: little gold diamonds
  g.fillStyle = '#ffd35a';
  for (const [x, y] of s.n) { g.beginPath(); g.moveTo(x!, y! - 6); g.lineTo(x! + 4.5, y!); g.lineTo(x!, y! + 6); g.lineTo(x! - 4.5, y!); g.fill(); }
  // bullets
  g.lineWidth = 3; g.strokeStyle = '#fff3c4';
  g.beginPath(); for (const [x, y, vx, vy] of s.b) { g.moveTo(x!, y!); g.lineTo(x! - vx! * 0.15, y! - vy! * 0.15); } g.stroke();
  g.globalAlpha = 0.25; g.lineWidth = 8; g.strokeStyle = '#f4b728'; g.stroke(); g.globalAlpha = 1;
  // enemies; spawning ones blink in
  for (const e of s.e) {
    const [, ki, x, y, a, r, spawning] = e as number[];
    if (spawning && Math.floor(t * 12) % 2) continue;
    const trail = e.length > 7 ? (e.slice(7) as number[]) : undefined;
    // with music on, enemies throb with the bass (drawn size only, never the hitbox)
    enemy(g, KINDS[ki!]!, x!, y!, a!, live ? r! * (1 + vibe.bass * 0.28 + vibe.beat * 0.12) : r!, t, trail);
  }
  fx.draw(g);
  // ships; shielded ones stay visible and breathe inside a cyan bubble
  for (const p of s.p) {
    const [id, x, y, aim, alive, inv] = p as [string, number, number, number, number, number];
    if (!alive) continue;
    const w = who[id], design = shipById(w?.ship ?? 'zship'), own = w?.color ?? '#f4b728';
    const breathe = inv ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
    if (inv) {
      g.globalAlpha = 0.18 + breathe * 0.35; g.lineWidth = 2 + breathe * 2; g.strokeStyle = '#7df9ff';
      g.beginPath(); g.arc(x, y, 30 - breathe * 4, 0, 7); g.stroke(); g.globalAlpha = 1;
    }
    g.save(); g.translate(x, y); g.rotate(design.spins ? t * 2 : aim); g.scale(1.38 + breathe * 0.1, 1.38 + breathe * 0.1);
    shipGlow(g, inv && breathe > 0.5 ? '#7df9ff' : own, 2.9, () => design.draw(g, t));
    g.restore();
    if (Object.keys(who).length > 1) {
      g.globalCompositeOperation = 'source-over';
      g.font = '600 13px ui-monospace, monospace'; g.textAlign = 'center'; g.fillStyle = w?.color ?? '#fff';
      g.fillText(w?.name ?? '', x, y + 34);
      g.globalCompositeOperation = 'lighter';
    }
  }
  g.globalCompositeOperation = 'source-over';
  g.setTransform(1, 0, 0, 1, 0, 0);
  // keep this frame for the next one's echo
  if (trip && echo) {
    if (echo.width !== cw || echo.height !== ch) { echo.width = cw; echo.height = ch; }
    echo.getContext('2d')!.drawImage(g.canvas, 0, 0);
  }
  return { k, ox, oy };
}

/** The little spectrum on the music button: cyan bars in Groove; in Trip each bar its own drifting hue, mirrored and glowing. */
export function spectrum(cv: HTMLCanvasElement | null, vibe: Vibe, t: number) {
  if (!cv) return;
  const g = cv.getContext('2d')!, w = cv.width, h = cv.height, n = vibe.bars.length, bw = w / n;
  g.clearRect(0, 0, w, h);
  const trip = vibe.mode === 'trip';
  for (let i = 0; i < n; i++) {
    const v = vibe.silent ? 0.06 : Math.max(0.06, vibe.bars[i]!), bh = v * (trip ? h / 2 : h);
    g.fillStyle = trip ? `hsl(${(vibe.hue + i * 45 + t * 90) % 360}, 95%, ${55 + v * 25}%)` : `rgba(125,249,255,${0.55 + v * 0.45})`;
    if (trip) { g.shadowColor = g.fillStyle; g.shadowBlur = 4; g.fillRect(i * bw + 0.5, h / 2 - bh, bw - 1, bh * 2); }
    else g.fillRect(i * bw + 0.5, h - bh, bw - 1, bh);
  }
  g.shadowBlur = 0;
}

