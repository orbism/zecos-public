/**
 * The ships. One is picked at random every time you play, because nobody in
 * Zcash should be the same twice. Each is drawn as line art around (0, 0),
 * nose pointing along +x, about 18 units from the centre to the tip.
 */

export interface ShipDesign {
  id: string;
  name: string;
  /** Said once, at the start of a run. */
  tagline: string;
  draw: (g: CanvasRenderingContext2D, t: number) => void;
  /** Spins on its own instead of pointing where it aims (coins don't have noses). */
  spins?: boolean;
}

const line = (g: CanvasRenderingContext2D, pts: number[][], close = false) => {
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!))); if (close) g.closePath(); g.stroke();
};
const ring = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); };
/** The Zcash Z, with its nubs. */
const zed = (g: CanvasRenderingContext2D, s: number) => { line(g, [[-s, -s], [s, -s], [-s, s], [s, s]]); line(g, [[0, -s * 1.5], [0, -s]]); line(g, [[0, s], [0, s * 1.5]]); };

export const SHIPS: ShipDesign[] = [
  {
    id: 'zship', name: 'The Z-Ship', tagline: 'Standard issue. Shielded by default.',
    draw: (g) => { line(g, [[18, 0], [-10, -13], [-4, 0], [-10, 13]], true); line(g, [[-1, -6], [8, -6], [-1, 6], [8, 6]]); },
  },
  {
    id: 'coin', name: 'The Coin', tagline: 'You are the money now. Try not to get spent.', spins: true,
    draw: (g, t) => { ring(g, 0, 0, 15); g.save(); g.scale(Math.cos(t * 3) * 0.25 + 0.75, 1); zed(g, 6); g.restore(); },
  },
  {
    id: 'note', name: 'A Shielded Note', tagline: 'Encrypted, unlinkable, and extremely annoyed.',
    draw: (g) => { line(g, [[18, 0], [0, -12], [-14, 0], [0, 12]], true); ring(g, 1, 0, 4); },
  },
  {
    id: 'turnstile', name: 'The Turnstile', tagline: 'Everything that goes in must come out. Especially bullets.', spins: true,
    draw: (g, t) => { ring(g, 0, 0, 5); for (let i = 0; i < 3; i++) { const a = t * 4 + (i * Math.PI * 2) / 3; line(g, [[Math.cos(a) * 5, Math.sin(a) * 5], [Math.cos(a) * 17, Math.sin(a) * 17]]); } },
  },
  {
    id: 'halving', name: 'The Halving', tagline: 'Half the size. Twice the attitude.',
    draw: (g) => { g.beginPath(); g.arc(0, 0, 15, -Math.PI / 2, Math.PI / 2); g.closePath(); g.stroke(); line(g, [[0, -9], [-8, 0], [0, 9]]); },
  },
  {
    id: 'u1', name: 'Unified Address', tagline: 'One ship for every pool. Very long name tag.',
    draw: (g) => { line(g, [[-14, -10], [-14, 4], [-9, 9], [-4, 4], [-4, -10]]); line(g, [[4, -6], [9, -10], [9, 10]]); line(g, [[18, 0], [12, -4], [12, 4]], true); },
  },
  {
    id: 'memo', name: 'The Memo', tagline: '512 bytes of encrypted trash talk.',
    draw: (g) => { line(g, [[-14, -10], [14, -10], [14, 10], [-14, 10]], true); line(g, [[-14, -10], [0, 2], [14, -10]]); line(g, [[14, 0], [20, 0]]); },
  },
  {
    id: 'nullifier', name: 'The Nullifier', tagline: 'Spends once. Shoots forever.',
    draw: (g) => { ring(g, 0, 0, 14); line(g, [[-10, 10], [10, -10]]); line(g, [[14, 0], [20, 0]]); },
  },
  {
    id: 'sapling', name: 'A Sapling', tagline: 'Upgraded from Sprout. Still growing. Still dangerous.',
    draw: (g) => { line(g, [[-12, 0], [16, 0]]); g.beginPath(); g.ellipse(6, -6, 8, 4, -0.5, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.ellipse(2, 6, 7, 3.5, 0.5, 0, Math.PI * 2); g.stroke(); },
  },
  {
    id: 'setup', name: 'The Trusted Setup', tagline: 'Toxic waste disposed of. Mostly.',
    draw: (g) => { line(g, [[16, 0], [-8, -14], [-8, 14]], true); line(g, [[-8, -6], [-15, -10]]); line(g, [[-8, 6], [-15, 10]]); ring(g, 0, 0, 3); },
  },
  {
    id: 'zebra', name: 'Zebra', tagline: 'Rewritten in Rust. Doesn’t crash. Unlike you.',
    draw: (g) => { line(g, [[18, 0], [-12, -12], [-12, 12]], true); for (const x of [-6, 0, 6]) line(g, [[x, -(9 - (x + 12) * 0.4)], [x, 9 - (x + 12) * 0.4]]); },
  },
  {
    id: 'orchard', name: 'Orchard Seed', tagline: 'Halo 2 inside. No trusted setup. No mercy.',
    draw: (g) => { g.beginPath(); g.ellipse(2, 0, 14, 10, 0, 0, Math.PI * 2); g.stroke(); line(g, [[-12, 0], [-18, -5]]); ring(g, 4, 0, 4); },
  },
];

export function randomShip(rng: () => number = Math.random): ShipDesign {
  return SHIPS[Math.floor(rng() * SHIPS.length)]!;
}
export const shipById = (id: string) => SHIPS.find((s) => s.id === id) ?? SHIPS[0]!;

/** Colours for players 1-4. */
export const PLAYER_COLORS = ['#f4b728', '#ff7a2a', '#3ddc84', '#b48cff'];
