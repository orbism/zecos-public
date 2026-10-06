/**
 * Zeometry Wars: the simulation. No drawing here, so the same world runs a
 * solo game, or runs on the host of an online game while the guests only
 * draw the snapshots it sends.
 *
 * The arena is a fixed 1600 x 1000; the view scales it to fit the window.
 */

export const W = 1600, H = 1000;

export type Mode = 'solo' | 'coop' | 'versus';
export type EnemyKind = 'tracker' | 'dust' | 'doxxer' | 'shard' | 'reuse' | 'analyst' | 'deanon';

export interface Input { mx: number; my: number; ax: number; ay: number; fire: boolean; bomb: boolean }
export const NO_INPUT: Input = { mx: 0, my: 0, ax: 1, ay: 0, fire: false, bomb: false };

export interface Player {
  id: string; name: string; color: string; ship: string;
  x: number; y: number; vx: number; vy: number; aim: number;
  alive: boolean; respawn: number; invuln: number; fireCd: number;
  /** Versus keeps everything per player; co-op shares the team's. */
  score: number; mult: number; lives: number; bombs: number; out: boolean;
  bombLatch: boolean;
}
export interface Enemy {
  id: number; k: EnemyKind; x: number; y: number; vx: number; vy: number; a: number; r: number;
  hp: number; age: number; spawn: number; mass: number; trail?: number[];
}
export interface Bullet { x: number; y: number; vx: number; vy: number; life: number; owner: string }
export interface Note { x: number; y: number; vx: number; vy: number; life: number }

export type GameEvent =
  | { k: 'boom'; x: number; y: number; c: string; n: number }
  | { k: 'bomb'; x: number; y: number; by: string }
  | { k: 'die'; pid: string; by: EnemyKind; x: number; y: number }
  | { k: 'wave'; n: number; title: string }
  | { k: 'shot'; x: number; y: number }
  | { k: 'note' }
  | { k: 'life'; pid: string }
  | { k: 'over' };

export const COLORS: Record<EnemyKind, string> = {
  tracker: '#4d7cff', dust: '#7df9ff', doxxer: '#3ddc84', shard: '#b48cff', reuse: '#ff7a2a', analyst: '#ff4d5a', deanon: '#ff4fd8',
};
export const POINTS: Record<EnemyKind, number> = { tracker: 50, dust: 100, doxxer: 100, shard: 50, reuse: 150, analyst: 200, deanon: 250 };
export const NAMES: Record<EnemyKind, string> = {
  tracker: 'a Tracker', dust: 'some Dust', doxxer: 'a Doxxer', shard: 'a leaked Shard', reuse: 'Address Reuse', analyst: 'a Chain Analyst', deanon: 'the Deanonymizer',
};
/** What the game over screen calls it. */
export const DEATH_LINES: Record<EnemyKind, string[]> = {
  tracker: ['TRACKED', 'Followed home by a Tracker.'],
  dust: ['DUSTED', 'A dust attack. Tiny, cheap, effective.'],
  doxxer: ['DOXXED', 'Your name, address and favourite colour, all public now.'],
  shard: ['LEAKED', 'Killed by a piece of a piece of a Doxxer. Embarrassing.'],
  reuse: ['LINKED', 'Address reuse. You were warned. Many times.'],
  analyst: ['ANALYSED', 'A Chain Analyst drew a graph of you. It was not flattering.'],
  deanon: ['DEANONYMIZED', 'Pulled in by the Deanonymizer. Nothing escapes it. Except shielded notes.'],
};

const WAVE_TITLES = ['GENESIS', 'SPROUT', 'OVERWINTER', 'SAPLING', 'BLOSSOM', 'HEARTWOOD', 'CANOPY', 'NU5 · ORCHARD', 'NU6', 'ZSA SEASON', 'CROSSLINK', 'TACHYON', 'THE HALVING', 'IRONWOOD'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class World {
  mode: Mode;
  players: Player[] = [];
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  notes: Note[] = [];
  events: GameEvent[] = [];
  t = 0; wave = 0; waveT = 0; spawnT = 1.5; nextId = 1;
  /** The team's, in solo and co-op. */
  score = 0; mult = 1; lives = 3; bombs = 3;
  over = false;
  /** What a leaderboard can check a score against. */
  stats = { kills: {} as Record<string, number>, notes: 0, bombs: 0, peakMult: 1 };
  /** The thing that ended it, for the last word. */
  lastKiller: EnemyKind = 'tracker';
  baseHeight: number;
  private lifeAt = 75_000; private bombAt = 150_000;

  constructor(mode: Mode, players: { id: string; name: string; color: string; ship: string }[], baseHeight = 3_141_592) {
    this.mode = mode;
    this.baseHeight = baseHeight;
    players.forEach((p, i) => this.players.push({
      ...p, x: W / 2 + (i - (players.length - 1) / 2) * 120, y: H / 2, vx: 0, vy: 0, aim: -Math.PI / 2,
      alive: true, respawn: 0, invuln: 2, fireCd: 0, score: 0, mult: 1, lives: 3, bombs: 3, out: false, bombLatch: false,
    }));
  }

  private team(p: Player) { return this.mode === 'versus' ? p : this; }

  step(dt: number, inputs: Record<string, Input>) {
    if (this.over) return;
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    this.director(dt);
    for (const p of this.players) this.stepPlayer(p, inputs[p.id] ?? NO_INPUT, dt);
    this.stepBullets(dt);
    this.stepEnemies(dt);
    this.stepNotes(dt);
    this.collide();
    this.checkOver();
  }

  // ── Spawning ────────────────────────────────────────────────────────────
  private director(dt: number) {
    this.waveT -= dt;
    if (this.waveT <= 0) {
      this.wave++; this.waveT = 30;
      this.events.push({ k: 'wave', n: this.wave, title: WAVE_TITLES[(this.wave - 1) % WAVE_TITLES.length]! });
      this.formation();
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const w = this.wave;
      this.spawnT = Math.max(0.22, 1.0 - w * 0.06) * rand(0.7, 1.3);
      const pool: EnemyKind[] = ['tracker', 'tracker', 'dust'];
      if (w >= 2) pool.push('doxxer', 'dust');
      if (w >= 3) pool.push('analyst');
      if (w >= 4) pool.push('reuse');
      const n = 1 + Math.floor(w / 3) + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) this.spawnAtEdge(pool[Math.floor(Math.random() * pool.length)]!);
      if (w >= 4 && Math.random() < 0.02 + w * 0.004 && this.enemies.filter((e) => e.k === 'deanon').length < 2) this.spawnAtEdge('deanon');
    }
  }
  /** Each new block brings a set piece. */
  private formation() {
    const w = this.wave, pick = w % 4;
    if (pick === 1) for (const [x, y] of [[60, 60], [W - 60, 60], [60, H - 60], [W - 60, H - 60]]) for (let i = 0; i < 4 + w; i++) this.spawn('tracker', x! + rand(-30, 30), y! + rand(-30, 30));
    else if (pick === 2) { const p = this.target(W / 2, H / 2); if (p) for (let i = 0; i < 10 + w; i++) { const a = (i / (10 + w)) * Math.PI * 2; this.spawn('dust', clamp(p.x + Math.cos(a) * 320, 30, W - 30), clamp(p.y + Math.sin(a) * 320, 30, H - 30)); } }
    else if (pick === 3) for (let i = 0; i < 6 + w; i++) this.spawn('doxxer', rand(40, W - 40), i % 2 ? 40 : H - 40);
    else if (w > 1) { this.spawn('deanon', W / 2 + rand(-300, 300), H / 2 + rand(-200, 200)); for (let i = 0; i < 4; i++) this.spawnAtEdge('analyst'); }
  }
  private spawnAtEdge(k: EnemyKind) {
    for (let tries = 0; tries < 8; tries++) {
      const x = rand(30, W - 30), y = rand(30, H - 30);
      if (this.players.every((p) => !p.alive || dist2(p.x, p.y, x, y) > 280 ** 2)) { this.spawn(k, x, y); return; }
    }
  }
  spawn(k: EnemyKind, x: number, y: number): Enemy {
    const r = { tracker: 14, dust: 13, doxxer: 15, shard: 9, reuse: 11, analyst: 15, deanon: 28 }[k];
    const e: Enemy = { id: this.nextId++, k, x, y, vx: 0, vy: 0, a: rand(0, 6), r, hp: k === 'deanon' ? 18 : 1, age: 0, spawn: 0.6, mass: 0 };
    if (k === 'reuse') e.trail = Array.from({ length: 24 }, () => [x, y]).flat();
    if (k === 'doxxer' || k === 'shard') { const a = rand(0, Math.PI * 2), s = k === 'shard' ? 220 : 110; e.vx = Math.cos(a) * s; e.vy = Math.sin(a) * s; }
    this.enemies.push(e);
    return e;
  }

  // ── Players ─────────────────────────────────────────────────────────────
  private stepPlayer(p: Player, inp: Input, dt: number) {
    if (p.out) return;
    if (!p.alive) {
      p.respawn -= dt;
      if (p.respawn <= 0 && (this.mode === 'versus' ? p.lives > 0 : this.lives > 0)) { p.alive = true; p.invuln = 2.2; p.x = W / 2; p.y = H / 2; p.vx = p.vy = 0; }
      return;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    const m = Math.hypot(inp.mx, inp.my) || 1, sp = 600;
    p.vx = (inp.mx / Math.max(1, m)) * sp; p.vy = (inp.my / Math.max(1, m)) * sp;
    p.x = clamp(p.x + p.vx * dt, 14, W - 14); p.y = clamp(p.y + p.vy * dt, 14, H - 14);
    if (inp.ax || inp.ay) p.aim = Math.atan2(inp.ay, inp.ax);
    // gravity wells pull ships too
    for (const e of this.enemies) if (e.k === 'deanon' && e.spawn <= 0) {
      const d2 = dist2(e.x, e.y, p.x, p.y), d = Math.sqrt(d2) || 1;
      if (d < 420) { const f = (1 - d / 420) * 260 * dt; p.x += ((e.x - p.x) / d) * f; p.y += ((e.y - p.y) / d) * f; }
    }
    p.fireCd -= dt;
    if (inp.fire && p.fireCd <= 0) {
      const team = this.team(p);
      p.fireCd = 0.085;
      const spread = team.mult >= 25 ? [-0.1, -0.03, 0.03, 0.1] : team.mult >= 10 ? [-0.07, 0, 0.07] : [-0.04, 0.04];
      for (const s of spread) {
        const a = p.aim + s;
        this.bullets.push({ x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16, vx: Math.cos(a) * 980, vy: Math.sin(a) * 980, life: 1.1, owner: p.id });
      }
      this.events.push({ k: 'shot', x: p.x, y: p.y });
    }
    if (inp.bomb && !p.bombLatch) this.bomb(p);
    p.bombLatch = inp.bomb;
  }
  private bomb(p: Player) {
    const team = this.team(p);
    if (team.bombs <= 0) return;
    team.bombs--; this.stats.bombs++;
    for (const e of this.enemies) this.events.push({ k: 'boom', x: e.x, y: e.y, c: COLORS[e.k], n: 10 });
    this.enemies = [];
    p.invuln = Math.max(p.invuln, 1.2);
    this.events.push({ k: 'bomb', x: p.x, y: p.y, by: p.id });
  }

  // ── Everything else ─────────────────────────────────────────────────────
  private stepBullets(dt: number) {
    for (const b of this.bullets) {
      for (const e of this.enemies) if (e.k === 'deanon' && e.spawn <= 0) {
        const d2 = dist2(e.x, e.y, b.x, b.y);
        if (d2 < 260 ** 2) { const d = Math.sqrt(d2) || 1, f = (1 - d / 260) * 2600 * dt; b.vx += ((e.x - b.x) / d) * f; b.vy += ((e.y - b.y) / d) * f; }
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) { b.life = 0; this.events.push({ k: 'boom', x: clamp(b.x, 0, W), y: clamp(b.y, 0, H), c: '#7da2ff', n: 2 }); }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }
  /** The closest living player. */
  private target(x: number, y: number): Player | undefined {
    let best: Player | undefined, bd = Infinity;
    for (const p of this.players) if (p.alive) { const d = dist2(p.x, p.y, x, y); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  private stepEnemies(dt: number) {
    for (const e of this.enemies) {
      e.age += dt;
      if (e.spawn > 0) { e.spawn -= dt; continue; }
      const p = this.target(e.x, e.y);
      const tx = p?.x ?? W / 2, ty = p?.y ?? H / 2;
      const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
      switch (e.k) {
        case 'tracker': e.vx += ((dx / d) * 150 - e.vx) * 2 * dt; e.vy += ((dy / d) * 150 - e.vy) * 2 * dt; e.a += dt * 3; break;
        case 'analyst': { const s = 230 + Math.min(e.age, 6) * 30; e.vx += ((dx / d) * s - e.vx) * 3 * dt; e.vy += ((dy / d) * s - e.vy) * 3 * dt; e.a += dt; break; }
        case 'dust': {
          let ox = 0, oy = 0;
          for (const b of this.bullets) { const bd2 = dist2(b.x, b.y, e.x, e.y); if (bd2 < 110 ** 2 && (b.vx * (e.x - b.x) + b.vy * (e.y - b.y)) > 0) { ox += -b.vy; oy += b.vx; } }
          const om = Math.hypot(ox, oy);
          const sx = om ? (ox / om) * 420 : 0, sy = om ? (oy / om) * 420 : 0;
          e.vx += ((dx / d) * 190 + sx - e.vx) * 4 * dt; e.vy += ((dy / d) * 190 + sy - e.vy) * 4 * dt;
          e.a = Math.atan2(e.vy, e.vx); break;
        }
        case 'doxxer': case 'shard':
          if (e.x < e.r || e.x > W - e.r) e.vx *= -1;
          if (e.y < e.r || e.y > H - e.r) e.vy *= -1;
          e.a += dt * (e.k === 'shard' ? 8 : 1.5); break;
        case 'reuse': {
          const wob = Math.sin(e.age * 4) * 0.9, base = Math.atan2(dy, dx) + wob;
          e.a += Math.atan2(Math.sin(base - e.a), Math.cos(base - e.a)) * 3 * dt;
          e.vx = Math.cos(e.a) * 170; e.vy = Math.sin(e.a) * 170;
          const tr = e.trail!;
          if (Math.hypot(tr[0]! - e.x, tr[1]! - e.y) > 9) { tr.unshift(e.x, e.y); tr.length = 48; }
          break;
        }
        case 'deanon': {
          e.vx *= 0.98; e.vy *= 0.98; e.a += dt * 0.6;
          // swallows anything that drifts too close, and grows
          for (const o of this.enemies) if (o !== e && o.k !== 'deanon' && o.spawn <= 0) {
            const od = Math.hypot(o.x - e.x, o.y - e.y) || 1;
            if (od < 300) { const f = (1 - od / 300) * 420 * dt; o.x += ((e.x - o.x) / od) * f; o.y += ((e.y - o.y) / od) * f; }
            if (od < e.r) { o.hp = 0; e.mass++; e.r = Math.min(60, e.r + 1.2); }
          }
          if (e.mass >= 18) { e.hp = 0; for (let i = 0; i < 14; i++) { const s = this.spawn('shard', e.x, e.y); s.spawn = 0; } this.events.push({ k: 'boom', x: e.x, y: e.y, c: COLORS.deanon, n: 60 }); }
          break;
        }
      }
      e.x = clamp(e.x + e.vx * dt, e.r, W - e.r); e.y = clamp(e.y + e.vy * dt, e.r, H - e.r);
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }
  private stepNotes(dt: number) {
    for (const n of this.notes) {
      n.life -= dt;
      const p = this.target(n.x, n.y);
      if (p) { const d = Math.hypot(p.x - n.x, p.y - n.y) || 1; if (d < 140) { n.vx += ((p.x - n.x) / d) * 1600 * dt; n.vy += ((p.y - n.y) / d) * 1600 * dt; } }
      n.vx *= 0.95; n.vy *= 0.95; n.x += n.vx * dt; n.y += n.vy * dt;
      if (p && d2ok(p, n)) { n.life = 0; const team = this.team(p); team.mult = Math.min(150, team.mult + 1); this.stats.notes++; this.stats.peakMult = Math.max(this.stats.peakMult, team.mult); this.events.push({ k: 'note' }); }
    }
    this.notes = this.notes.filter((n) => n.life > 0);
  }
  private kill(e: Enemy, by?: Player) {
    e.hp = 0;
    this.events.push({ k: 'boom', x: e.x, y: e.y, c: COLORS[e.k], n: e.k === 'deanon' ? 70 : 26 });
    if (by) {
      const team = this.team(by);
      team.score += POINTS[e.k] * team.mult;
      this.stats.kills[e.k] = (this.stats.kills[e.k] ?? 0) + 1;
      this.extras(by);
    }
    if (e.k === 'doxxer') for (let i = 0; i < 2; i++) { const s = this.spawn('shard', e.x + rand(-6, 6), e.y + rand(-6, 6)); s.spawn = 0.15; }
    const drops = e.k === 'deanon' ? 12 : e.k === 'shard' ? 1 : 2;
    for (let i = 0; i < drops; i++) { const a = rand(0, 6.28), s = rand(40, 160); this.notes.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 6 }); }
  }
  /** An extra ship every 75k, a turnstile every 150k. */
  private extras(p: Player) {
    const team = this.team(p);
    if (this.mode === 'versus') return;
    while (team.score >= this.lifeAt) { this.lives++; this.lifeAt += 75_000; this.events.push({ k: 'life', pid: p.id }); }
    while (team.score >= this.bombAt) { this.bombs++; this.bombAt += 150_000; }
  }
  private collide() {
    for (const b of this.bullets) {
      if (b.life <= 0) continue;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawn > 0) continue;
        if (e.k === 'reuse') {
          // the body eats bullets; only the head can die
          const tr = e.trail!;
          for (let i = 6; i < tr.length; i += 6) if (dist2(tr[i]!, tr[i + 1]!, b.x, b.y) < 10 ** 2) { b.life = 0; break; }
          if (b.life <= 0) break;
        }
        if (dist2(e.x, e.y, b.x, b.y) < (e.r + 4) ** 2) {
          b.life = 0; e.hp--;
          if (e.k === 'deanon') { e.vx += b.vx * 0.02; e.vy += b.vy * 0.02; this.events.push({ k: 'boom', x: b.x, y: b.y, c: COLORS.deanon, n: 4 }); }
          if (e.hp <= 0) this.kill(e, this.players.find((p) => p.id === b.owner));
          break;
        }
      }
    }
    for (const p of this.players) {
      if (!p.alive || p.invuln > 0) continue;
      for (const e of this.enemies) {
        if (e.spawn > 0 || e.hp <= 0) continue;
        let hit = dist2(e.x, e.y, p.x, p.y) < (e.r + 10) ** 2;
        if (!hit && e.k === 'reuse') { const tr = e.trail!; for (let i = 6; i < tr.length && !hit; i += 6) hit = dist2(tr[i]!, tr[i + 1]!, p.x, p.y) < 16 ** 2; }
        if (hit) { this.die(p, e.k); break; }
      }
    }
  }
  private die(p: Player, by: EnemyKind) {
    p.alive = false; p.respawn = 1.6; this.lastKiller = by;
    this.events.push({ k: 'die', pid: p.id, by, x: p.x, y: p.y });
    this.events.push({ k: 'boom', x: p.x, y: p.y, c: p.color, n: 90 });
    const team = this.team(p);
    team.mult = 1;
    if (this.mode === 'versus') { p.lives--; if (p.lives <= 0) p.out = true; }
    else {
      this.lives--;
      // like the original: a death clears the board, so the respawn is fair
      for (const e of this.enemies) this.events.push({ k: 'boom', x: e.x, y: e.y, c: COLORS[e.k], n: 6 });
      this.enemies = []; this.notes = [];
    }
  }
  private checkOver() {
    const over = this.mode === 'versus'
      ? this.players.filter((p) => !p.out).length <= (this.players.length > 1 ? 1 : 0)
      : this.lives <= 0 && this.players.every((p) => !p.alive);
    if (over) { this.over = true; this.events.push({ k: 'over' }); }
  }

  /** The current block height the wave counter shows: one block per wave. */
  get height() { return this.baseHeight + this.wave; }

  // ── Network ─────────────────────────────────────────────────────────────
  snapshot(): Snapshot {
    const r = Math.round;
    return {
      t: this.t, wave: this.wave, score: this.score, mult: this.mult, lives: this.lives, bombs: this.bombs, over: this.over, killer: this.lastKiller,
      p: this.players.map((p) => [p.id, r(p.x), r(p.y), +p.aim.toFixed(2), p.alive ? 1 : 0, p.invuln > 0 ? 1 : 0, p.score, p.mult, p.lives, p.bombs, p.out ? 1 : 0]),
      e: this.enemies.map((e) => [e.id, KINDS.indexOf(e.k), r(e.x), r(e.y), +e.a.toFixed(2), r(e.r), e.spawn > 0 ? 1 : 0, ...(e.trail ? e.trail.filter((_, i) => i % 6 < 2).map(r) : [])]),
      b: this.bullets.map((b) => [r(b.x), r(b.y), r(b.vx / 10), r(b.vy / 10)]),
      n: this.notes.map((n) => [r(n.x), r(n.y)]),
      ev: this.events.filter((e) => e.k !== 'shot'),
    };
  }
}

const d2ok = (p: Player, n: Note) => dist2(p.x, p.y, n.x, n.y) < 22 ** 2;
export const KINDS: EnemyKind[] = ['tracker', 'dust', 'doxxer', 'shard', 'reuse', 'analyst', 'deanon'];

export interface Snapshot {
  t: number; wave: number; score: number; mult: number; lives: number; bombs: number; over: boolean; killer: EnemyKind;
  /** Players: id, x, y, aim, alive, invuln, score, mult, lives, bombs, out. */
  p: (string | number)[][];
  /** Enemies: id, kind index, x, y, angle, radius, spawning, then the snake's trail as x,y pairs. */
  e: number[][]; b: number[][]; n: number[][]; ev: GameEvent[];
}
