import type { ReactNode } from 'react';

/**
 * The default ZIM picture: a small weird creature, the same one every time for
 * the same seed. Everyone starts on the face their account id grows; "Re-roll"
 * just picks a new seed. Pure SVG, no assets.
 */

/** A seeded PRNG: the seed's hash through mulberry32. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const range = (lo: number, hi: number) => lo + next() * (hi - lo);
  return { next, pick, range, chance: (p: number) => next() < p };
}

const BODIES = ['blob', 'bean', 'box', 'ghost', 'onion', 'tall'] as const;
const EYES = ['googly', 'googly', 'dot', 'sleepy', 'x', 'star'] as const;
const MOUTHS = ['smile', 'grin', 'o', 'zigzag', 'tongue', 'flat', 'fangs', 'uwu'] as const;
const HATS = ['party', 'propeller', 'crown', 'antenna', 'tophat', 'sprout', 'bow', 'mustache', 'monocle'] as const;

function body(kind: (typeof BODIES)[number], fill: string): ReactNode {
  const s = { fill, stroke: '#111', strokeWidth: 2 };
  switch (kind) {
    case 'blob': return <ellipse cx="32" cy="36" rx="20" ry="19" {...s} />;
    case 'bean': return <path d="M18 30c0-12 12-18 21-13s8 10 5 17 3 12-3 18-23 4-23-8 0-8 0-14z" {...s} />;
    case 'box': return <rect x="13" y="17" width="38" height="38" rx="9" {...s} />;
    case 'ghost': return <path d="M13 56V33a19 19 0 0 1 38 0v23l-5-4-5 4-5-4-4 4-5-4-5 4-4-4z" {...s} />;
    case 'onion': return <path d="M32 12c4 8 20 16 18 30-1 9-9 14-18 14s-17-5-18-14c-2-14 14-22 18-30z" {...s} />;
    case 'tall': return <rect x="19" y="11" width="26" height="46" rx="13" {...s} />;
  }
}

function eye(kind: (typeof EYES)[number], x: number, y: number, r: number, look: [number, number], key: number): ReactNode {
  switch (kind) {
    case 'googly': return (
      <g key={key}><circle cx={x} cy={y} r={r} fill="#fff" stroke="#111" strokeWidth="1.5" />
        <circle cx={x + look[0] * r * 0.45} cy={y + look[1] * r * 0.45} r={r * 0.45} fill="#111" /></g>
    );
    case 'dot': return <circle key={key} cx={x} cy={y} r={r * 0.5} fill="#111" />;
    case 'sleepy': return <path key={key} d={`M${x - r} ${y}q${r} ${r * 0.8} ${r * 2} 0`} stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" />;
    case 'x': return <path key={key} d={`M${x - r * 0.6} ${y - r * 0.6}l${r * 1.2} ${r * 1.2}m0 ${-r * 1.2}l${-r * 1.2} ${r * 1.2}`} stroke="#111" strokeWidth="2" strokeLinecap="round" />;
    case 'star': return <path key={key} d={`M${x} ${y - r}l${r * 0.3} ${r * 0.7} ${r * 0.7} ${r * 0.3} -${r * 0.7} ${r * 0.3} -${r * 0.3} ${r * 0.7} -${r * 0.3} -${r * 0.7} -${r * 0.7} -${r * 0.3} ${r * 0.7} -${r * 0.3}z`} fill="#fff" stroke="#111" strokeWidth="1.2" />;
  }
}

function mouth(kind: (typeof MOUTHS)[number], y: number): ReactNode {
  const s = { stroke: '#111', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'smile': return <path d={`M25 ${y}q7 7 14 0`} fill="none" {...s} />;
    case 'grin': return <g><path d={`M24 ${y}h16q-1 8-8 8t-8-8z`} fill="#fff" {...s} /><path d={`M28 ${y}v3M32 ${y}v4M36 ${y}v3`} {...s} strokeWidth={1.2} /></g>;
    case 'o': return <ellipse cx="32" cy={y + 2} rx="3.5" ry="4.5" fill="#3a0d12" {...s} />;
    case 'zigzag': return <path d={`M24 ${y + 1}l3-3 3 3 3-3 3 3 3-3 3 3`} fill="none" {...s} />;
    case 'tongue': return <g><path d={`M25 ${y}q7 6 14 0`} fill="none" {...s} /><path d={`M30 ${y + 3}q2 6 5 0`} fill="#ff6b8b" {...s} strokeWidth={1.4} /></g>;
    case 'flat': return <path d={`M26 ${y + 1}h12`} {...s} />;
    case 'fangs': return <g><path d={`M24 ${y}q8 5 16 0`} fill="none" {...s} /><path d={`M27 ${y + 1}l1.5 4 1.5-3M34 ${y + 2}l1.5 3 1.5-4`} fill="#fff" {...s} strokeWidth={1.2} /></g>;
    case 'uwu': return <path d={`M26 ${y}q3 4 6 0q3 4 6 0`} fill="none" {...s} />;
  }
}

function hat(kind: (typeof HATS)[number], top: number, c: string): ReactNode {
  const s = { stroke: '#111', strokeWidth: 1.6, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'party': return <g><path d={`M24 ${top + 2}l8-16 8 16z`} fill={c} {...s} /><circle cx="32" cy={top - 14} r="2.5" fill="#fff" {...s} /></g>;
    case 'propeller': return <g><path d={`M22 ${top + 3}a10 7 0 0 1 20 0z`} fill={c} {...s} /><path d={`M32 ${top - 4}v-4M24 ${top - 9}h16`} {...s} strokeWidth={2.4} stroke="#111" /></g>;
    case 'crown': return <path d={`M22 ${top + 3}v-10l5 5 5-8 5 8 5-5v10z`} fill="#F4B728" {...s} />;
    case 'antenna': return <g><path d={`M27 ${top + 2}l-4-11M37 ${top + 2}l4-11`} {...s} fill="none" /><circle cx="23" cy={top - 10} r="2.6" fill={c} {...s} /><circle cx="41" cy={top - 10} r="2.6" fill={c} {...s} /></g>;
    case 'tophat': return <g><rect x="24" y={top - 14} width="16" height="14" fill="#222" {...s} /><rect x="19" y={top - 1} width="26" height="3.5" rx="1.5" fill="#222" {...s} /><rect x="24" y={top - 5} width="16" height="3" fill={c} /></g>;
    case 'sprout': return <g><path d={`M32 ${top + 2}v-9`} {...s} fill="none" /><path d={`M32 ${top - 6}q-8-3-9 3q6 2 9-3zM32 ${top - 5}q7-4 9 2q-6 3-9-2z`} fill="#5fcf6a" {...s} /></g>;
    case 'bow': return <path d={`M32 ${top + 3}l-9-5v10zM32 ${top + 3}l9-5v10z`} fill={c} {...s} />;
    // Face furniture rather than hats: drawn at the face, the top is ignored.
    case 'mustache': return <path d="M22 44q5-4 10 0q5-4 10 0q-3 4-10 1q-7 3-10-1z" fill="#3b2412" {...s} strokeWidth={1.2} />;
    case 'monocle': return <g><circle cx="40" cy="30" r="6" fill="none" {...s} strokeWidth={2} /><path d="M46 31q3 8-1 16" {...s} fill="none" strokeWidth={1} /></g>;
  }
}

export default function GenFace({ seed, size = 48 }: { seed: string; size?: number }) {
  const r = rng(seed);
  const hue = Math.floor(r.range(0, 360));
  const bg = `hsl(${(hue + 150 + r.range(0, 60)) % 360} 45% 22%)`;
  const skin = `hsl(${hue} ${Math.round(r.range(55, 80))}% ${Math.round(r.range(52, 66))}%)`;
  const accent = `hsl(${(hue + 200) % 360} 75% 60%)`;
  const shape = r.pick(BODIES);
  const eyeKind = r.pick(EYES);
  const n = r.chance(0.18) ? 1 : r.chance(0.2) ? 3 : 2;
  const er = n === 1 ? r.range(6, 8) : r.range(3.8, 5.6);
  const look: [number, number] = [r.range(-1, 1), r.range(-1, 1)];
  const eyeY = 29 + r.range(-2, 3);
  const xs = n === 1 ? [32] : n === 2 ? [25, 39] : [22, 32, 42];
  const topOf = shape === 'tall' ? 11 : shape === 'onion' ? 14 : 17;
  const extra = r.chance(0.7) ? r.pick(HATS) : null;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Generated profile picture" style={{ display: 'block' }}>
      <rect width="64" height="64" fill={bg} />
      {body(shape, skin)}
      {r.chance(0.3) && [0, 1, 2].map((i) => (
        <circle key={i} cx={r.range(20, 44)} cy={r.range(40, 52)} r={r.range(1.2, 2.4)} fill="#000" opacity=".15" />
      ))}
      {r.chance(0.45) && <g fill="#ff7a8a" opacity=".55"><ellipse cx="19" cy="38" rx="3.5" ry="2" /><ellipse cx="45" cy="38" rx="3.5" ry="2" /></g>}
      {xs.map((x, i) => eye(eyeKind, x, eyeY + (n === 3 && i === 1 ? -4 : 0), er, look, i))}
      {mouth(r.pick(MOUTHS), 41 + r.range(0, 3))}
      {extra && hat(extra, topOf, accent)}
    </svg>
  );
}
