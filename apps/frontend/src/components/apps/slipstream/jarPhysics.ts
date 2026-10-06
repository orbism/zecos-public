/**
 * Minimal circle-packing physics for the block "jar".
 *
 * Marbles fall under gravity, bounce off the jar walls and separate from each
 * other until the pile settles. Deliberately impulse-free and iterative rather
 * than a real solver: with a few hundred bodies that is stable, cheap and looks
 * right, and nothing here needs to be physically exact.
 */

export interface Marble {
  txid: string;
  /** Raw transaction size in bytes - the thing the radius is derived from. */
  bytes: number;
  color: string;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Frames spent nearly stationary; used to stop simulating a settled pile. */
  restFrames: number;
}

export interface JarBounds {
  left: number;
  right: number;
  /** Inner floor of the jar. */
  bottom: number;
  /** Mouth of the jar - marbles above this are still funnelling in. */
  top: number;
}

const GRAVITY = 0.42;
const RESTITUTION = 0.24;   // walls/floor are damp - marbles shouldn't bounce forever
const FLOOR_FRICTION = 0.82;
const AIR = 0.995;
const MAX_V = 14;
const SEPARATION_ITERS = 4;
const REST_EPSILON = 0.14;

/** Cell size for the broad phase; ~2x the largest expected radius works well. */
function gridKey(x: number, y: number, cell: number): number {
  // Pack two 16-bit cell coords into one number - cheaper than string keys.
  const cx = Math.floor(x / cell) + 32768;
  const cy = Math.floor(y / cell) + 32768;
  return cx * 65536 + cy;
}

/**
 * Advance the simulation one frame.
 *
 * `speed` scales the whole step so the pile can be shaken faster while a block
 * is settling without changing the tuning.
 */
export function stepJar(marbles: Marble[], jar: JarBounds, speed = 1): void {
  const n = marbles.length;
  if (n === 0) return;

  let maxR = 1;
  for (let i = 0; i < n; i++) if (marbles[i].r > maxR) maxR = marbles[i].r;
  const cell = Math.max(8, maxR * 2);

  // ── Integrate ────────────────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const m = marbles[i];
    m.vy += GRAVITY * speed;
    m.vx *= AIR;
    m.vy *= AIR;

    if (m.vx > MAX_V) m.vx = MAX_V; else if (m.vx < -MAX_V) m.vx = -MAX_V;
    if (m.vy > MAX_V) m.vy = MAX_V; else if (m.vy < -MAX_V) m.vy = -MAX_V;

    m.x += m.vx * speed;
    m.y += m.vy * speed;
  }

  // ── Separate overlapping pairs (broad phase on a uniform grid) ────────────
  for (let iter = 0; iter < SEPARATION_ITERS; iter++) {
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const k = gridKey(marbles[i].x, marbles[i].y, cell);
      const b = buckets.get(k);
      if (b) b.push(i);
      else buckets.set(k, [i]);
    }

    for (let i = 0; i < n; i++) {
      const a = marbles[i];
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = buckets.get(gridKey((cx + ox) * cell, (cy + oy) * cell, cell));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const j = bucket[bi];
            if (j <= i) continue;
            const b = marbles[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            const min = a.r + b.r;
            if (d2 >= min * min) continue;

            // Perfectly stacked marbles have no normal - nudge them apart.
            if (d2 < 1e-6) { dx = (Math.random() - 0.5) * 0.1; dy = -0.1; d2 = dx * dx + dy * dy; }
            const d = Math.sqrt(d2);
            const overlap = (min - d) / 2;
            const nx = dx / d;
            const ny = dy / d;

            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;

            // Bleed a little of the closing velocity so piles come to rest.
            const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rvn < 0) {
              const imp = rvn * 0.5 * (1 + RESTITUTION);
              a.vx += nx * imp; a.vy += ny * imp;
              b.vx -= nx * imp; b.vy -= ny * imp;
            }
          }
        }
      }
    }

    // ── Walls ─────────────────────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      const m = marbles[i];
      if (m.x - m.r < jar.left) { m.x = jar.left + m.r; m.vx = Math.abs(m.vx) * RESTITUTION; }
      if (m.x + m.r > jar.right) { m.x = jar.right - m.r; m.vx = -Math.abs(m.vx) * RESTITUTION; }
      if (m.y + m.r > jar.bottom) {
        m.y = jar.bottom - m.r;
        m.vy = -Math.abs(m.vy) * RESTITUTION;
        m.vx *= FLOOR_FRICTION;
      }
    }
  }

  // ── Rest tracking ────────────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const m = marbles[i];
    const moving = Math.abs(m.vx) + Math.abs(m.vy);
    if (moving < REST_EPSILON) {
      m.restFrames++;
      if (m.restFrames > 8) { m.vx = 0; m.vy = 0; }
    } else {
      m.restFrames = 0;
    }
  }
}

/**
 * Radius for a transaction, such that the marbles' combined AREA fills the jar
 * exactly when the mempool reaches block capacity.
 *
 * That keeps the pile an honest read of "how full is the next block": relative
 * marble sizes are exact (area ∝ bytes), and the fill level is the real
 * mempool-bytes ÷ capacity ratio. A floor keeps sub-pixel transactions
 * clickable - flagged rather than silently distorting the small end.
 */
export function radiusForBytes(
  bytes: number,
  capacityBytes: number,
  jarArea: number,
  minRadius = 3.5
): number {
  // Circles pack to ~90% of a container at best; account for it so a "full"
  // mempool visually reaches the brim rather than overflowing.
  const usable = jarArea * 0.9;
  const area = (Math.max(bytes, 1) / capacityBytes) * usable;
  return Math.max(minRadius, Math.sqrt(area / Math.PI));
}
