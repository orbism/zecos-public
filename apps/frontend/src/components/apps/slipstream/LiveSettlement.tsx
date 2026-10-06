'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChainData } from '@/hooks/useZecData';
import { useWindowStore } from '@/store/windowStore';
import { useExplorerStore } from '@/store/explorerStore';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { POOL_COLORS, sumSupply } from '@/config/pools';
import { fmtCompact } from './shared';
import { Colour } from '@/components/Colour';
import { stepJar, radiusForBytes, type Marble, type JarBounds } from './jarPhysics';
import { plot } from '@/lib/generative/engine';
import { useGenerative } from '@/lib/generative/useGenerative';
import { GlyphSea } from '@/lib/generative/GlyphSea';
import { packColour } from '@/lib/generative/GlyphField';

const POLL_MS = 12_000;
const ZAT = 100_000_000;

/**
 * Zcash consensus block-size cap, in bytes. This is what makes the jar an honest
 * gauge - pile volume is mempool bytes measured against this, not a flattering
 * rescale. Observed blocks run ~1.6kB-120kB, i.e. a few percent full.
 */
const BLOCK_CAPACITY_BYTES = 2_000_000;

/**
 * Lanes a transaction can settle into.
 *
 * Sprout is unspendable-to and Sapling sees no new mempool traffic (verified
 * against the live feed), so the view shows the three pools that actually move.
 * A Sapling lane appends itself only if legacy traffic genuinely turns up.
 */
/**
 * Receiving side. Orchard is CLOSED - it takes no new inbound value and has no
 * internal transfers; everything in it leaves through a turnstile into Ironwood,
 * so a transaction with Orchard actions but no Ironwood ones is value on its way
 * OUT. Sapling can still be sent to, so it stays a destination. Sprout cannot.
 */
const BASE_LANES = ['transparent', 'sapling', 'ironwood'] as const;
type Lane = 'transparent' | 'sprout' | 'sapling' | 'orchard' | 'ironwood';

/**
 * Sending side: every pool that still HOLDS value, so the sources reflect where
 * ZEC actually sits (Sprout 0.13%, Sapling 3.2%, Orchard 12.0% at time of
 * writing). Sprout, Sapling and Orchard tubes only ever drain.
 */
const SOURCE_LANES: readonly Lane[] = ['transparent', 'sprout', 'sapling', 'orchard', 'ironwood'];

/**
 * Largest radius scale that keeps every adjacent pair (and the row's ends)
 * clear, found by bisection. Lets the circles be as big as the space allows at
 * any width instead of being pinned to a conservative constant.
 */
function fitScale(
  lanes: readonly Lane[],
  vals: Record<Lane, number>,
  peak: number,
  spacing: number,
  leftRoom: number,
  rightRoom: number,
  floor: number,
  cap: number,
  gap = 6
): number {
  const rOf = (S: number, l: Lane) =>
    Math.max(floor, S * Math.sqrt(Math.max(vals[l] ?? 0, 1) / peak));
  const ok = (S: number) => {
    if (rOf(S, lanes[0]) > leftRoom) return false;
    if (rOf(S, lanes[lanes.length - 1]) > rightRoom) return false;
    for (let i = 1; i < lanes.length; i++) {
      if (rOf(S, lanes[i - 1]) + rOf(S, lanes[i]) + gap > spacing) return false;
    }
    return true;
  };
  let lo = floor;
  let hi = cap;
  if (ok(hi)) return hi;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

const LANE_COLOR: Record<Lane, string> = {
  transparent: POOL_COLORS.transparent,
  sprout: POOL_COLORS.sprout,
  sapling: POOL_COLORS.sapling,
  orchard: POOL_COLORS.orchard,
  ironwood: POOL_COLORS.ironwood,
};
const LANE_LABEL: Record<Lane, string> = {
  transparent: 't-addr',
  sprout: 'Sprout',
  sapling: 'Sapling',
  orchard: 'Orchard',
  ironwood: 'Ironwood',
};

interface RawTx {
  txid: string;
  orchardActions: number;
  ironwoodActions: number;
  saplingSpends: number;
  saplingOutputs: number;
  size: number;
  ageSeconds: number;
  ironwoodValueBalanceZat: number;
  orchardValueBalanceZat: number;
  saplingValueBalanceZat: number;
}

/** A marble waiting in the jar. */
type JarMarble = Marble & {
  lane: Lane;
  net: number;
  actions: number;
  /** Legacy pools this transaction is spending out of. */
  drains: { lane: Lane; actions: number }[];
};

/** A transaction sliding down its pool's chute toward the funnel. */
interface Chute {
  tx: RawTx;
  lane: Lane;
  /** 0 at the source node, 1 at the funnel mouth. */
  t: number;
  /** Small lateral offset so a burst doesn't slide down as one blob. */
  wobble: number;
}

/** A transaction released by a sealed block, flying out to its pool. */
interface Drain {
  txid: string;
  lane: Lane;
  r: number;
  t: number;
  fromX: number;
  fromY: number;
}

/**
 * Where a transaction's value ends up: Ironwood, Sapling, or back out to
 * transparent. Orchard is not an option - it cannot receive, so Orchard actions
 * without a shielded destination mean value leaving the shielded set.
 */
function laneOf(t: RawTx): Lane {
  if ((t.ironwoodActions ?? 0) > 0) return 'ironwood';
  if ((t.saplingOutputs ?? 0) > 0) return 'sapling';
  return 'transparent';
}

/** Closed-pool actions a transaction spends, shown in its readout. */
function drainsFrom(t: RawTx): { lane: Lane; actions: number }[] {
  const out: { lane: Lane; actions: number }[] = [];
  if ((t.orchardActions ?? 0) > 0) out.push({ lane: 'orchard', actions: t.orchardActions });
  return out;
}

function actionsOf(t: RawTx, lane: Lane): number {
  return lane === 'ironwood' ? (t.ironwoodActions ?? 0)
    : lane === 'orchard' ? (t.orchardActions ?? 0)
      : lane === 'sapling' ? (t.saplingSpends ?? 0) + (t.saplingOutputs ?? 0)
        : 0;
}

function netOf(t: RawTx, lane: Lane): number {
  const zat =
    lane === 'ironwood' ? t.ironwoodValueBalanceZat
      : lane === 'orchard' ? t.orchardValueBalanceZat
        : lane === 'sapling' ? t.saplingValueBalanceZat
          : 0;
  return (zat ?? 0) / ZAT;
}

function fmtBytes(b: number): string {
  if (b >= 1e6) return `${(b / 1e6).toFixed(2)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} kB`;
  return `${b} B`;
}

/**
 * Live settlement view.
 *
 * Unconfirmed transactions drop into the next block like marbles into a jar.
 * Each marble's AREA is its byte size against the consensus block cap, so pile
 * height reads as how full the next block actually is. When the chain tip
 * advances the jar empties and everything flies out along its pool's lane.
 */
export function LiveSettlement({ windowId: _windowId }: { windowId?: string }) {
  const { data: chain } = useChainData(15_000);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const marblesRef = useRef<JarMarble[]>([]);
  const drainsRef = useRef<Drain[]>([]);
  const pendingRef = useRef<RawTx[]>([]); // queued for staggered release
  const chuteRef = useRef<Chute[]>([]);   // in transit down the tubes
  const seenRef = useRef<Set<string>>(new Set());
  const sealRef = useRef(0);
  const surgeRef = useRef(0);
  const heightRef = useRef(0);
  const themeRef = useRef('');
  const hoverRef = useRef<string | null>(null);
  const lanesRef = useRef<Lane[]>([...BASE_LANES]);
  const dropClockRef = useRef(0);
  /** Live pool balances - node radius is area-proportional to these. */
  const poolsRef = useRef<{ vals: Record<Lane, number>; supply: number }>({
    vals: { transparent: 0, sprout: 0, sapling: 0, orchard: 0, ironwood: 0 }, supply: 0,
  });
  /** Screen positions of the pool nodes, for hit-testing. */
  const nodesRef = useRef<{ lane: Lane; x: number; y: number; r: number; where: 'origin' | 'destination' }[]>([]);

  const [lanes, setLanes] = useState<Lane[]>([...BASE_LANES]);
  const [stats, setStats] = useState({ count: 0, bytes: 0, height: 0, settled: 0 });
  type HoverInfo =
    | { kind: 'tx'; txid: string; lane: Lane; bytes: number; actions: number; net: number;
        drains: { lane: Lane; actions: number }[]; x: number; y: number }
    | { kind: 'pool'; lane: Lane; held: number; pct: number; x: number; y: number };
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [laneTotals, setLaneTotals] = useState<Record<Lane, number>>({
    transparent: 0, sprout: 0, sapling: 0, orchard: 0, ironwood: 0,
  });

  useEffect(() => {
    const p = chain?.pools;
    if (!p) return;
    poolsRef.current = {
      vals: {
        transparent: p.transparent ?? 0,
        sprout: p.sprout ?? 0,
        sapling: p.sapling ?? 0,
        orchard: p.orchard ?? 0,
        ironwood: p.ironwood ?? 0,
      },
      supply: sumSupply(p),
    };
  }, [chain?.pools]);

  useEffect(() => {
    const read = () => { themeRef.current = document.documentElement.getAttribute('data-theme') ?? ''; };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  // ── Seal: the tip advanced, so the jar empties ────────────────────────────
  useEffect(() => {
    const h = chain?.height ?? 0;
    if (!h) return;
    if (heightRef.current && h > heightRef.current) {
      sealRef.current = 1;
      surgeRef.current = 1;

      drainsRef.current = [
        ...drainsRef.current,
        ...marblesRef.current.map((m) => ({
          txid: m.txid, lane: m.lane, r: m.r, t: 0, fromX: m.x, fromY: m.y,
        })),
      ];
      const counts: Record<Lane, number> = { transparent: 0, sprout: 0, sapling: 0, orchard: 0, ironwood: 0 };
      for (const m of marblesRef.current) counts[m.lane] += 1;
      setLaneTotals((prev) => {
        const next = { ...prev };
        (Object.keys(counts) as Lane[]).forEach((k) => { next[k] += counts[k]; });
        return next;
      });
      setStats((s) => ({ ...s, settled: s.settled + marblesRef.current.length }));
      marblesRef.current = [];
    }
    heightRef.current = h;
    setStats((s) => ({ ...s, height: h }));
  }, [chain?.height]);

  // ── Poll the mempool ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mempool');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const txs = (json.transactions ?? []) as RawTx[];
      const summaryBytes = Number(json.summary?.bytes) || txs.reduce((s, t) => s + (t.size ?? 0), 0);

      const fresh = txs.filter((t) => t.txid && !seenRef.current.has(t.txid));
      for (const t of fresh) seenRef.current.add(t.txid);
      if (seenRef.current.size > 4000) seenRef.current = new Set(txs.map((t) => t.txid));

      // Dropped in one at a time by the render loop so the jar fills visibly.
      pendingRef.current = [...pendingRef.current, ...fresh].slice(-260);

      setStats((s) => ({ ...s, count: txs.length, bytes: summaryBytes }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'mempool unreachable');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // ── Interaction ───────────────────────────────────────────────────────────
  /** Pool node under the pointer, if any. Nodes win over marbles - they're bigger targets. */
  const pickNode = useCallback((x: number, y: number) => {
    for (const n of nodesRef.current) {
      if (Math.hypot(x - n.x, y - n.y) <= n.r + 6) return n;
    }
    return null;
  }, []);

  const pick = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: JarMarble | null = null;
    let bestD = Infinity;
    for (const m of marblesRef.current) {
      const d = Math.hypot(x - m.x, y - m.y);
      // Generous target: the smallest marbles are only a few px across.
      if (d <= Math.max(m.r + 4, 10) && d < bestD) { bestD = d; best = m; }
    }
    return best ? { m: best, x, y } : null;
  }, []);

  const onMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const node = pickNode(px, py);
    if (node) {
      hoverRef.current = null;
      const { vals, supply } = poolsRef.current;
      const held = vals[node.lane] ?? 0;
      setHover({
        kind: 'pool', lane: node.lane, held,
        pct: supply > 0 ? (held / supply) * 100 : 0,
        x: px, y: py,
      });
      return;
    }

    const hit = pick(e);
    hoverRef.current = hit?.m.txid ?? null;
    setHover(hit ? {
      kind: 'tx', txid: hit.m.txid, lane: hit.m.lane, bytes: hit.m.bytes,
      actions: hit.m.actions, net: hit.m.net, drains: hit.m.drains, x: hit.x, y: hit.y,
    } : null);
  }, [pick, pickNode]);

  const onLeave = useCallback(() => { hoverRef.current = null; setHover(null); }, []);

  const openTx = useCallback((txid: string) => {
    const { windows, openWindow, focusWindow } = useWindowStore.getState();
    const id = `explorer-tx-${txid.slice(0, 8)}`;
    if (!windows.find((w) => w.id === id)) {
      const size = { width: 860, height: 880 };
      const pos = calculateWindowPosition(
        windows, size,
        typeof window !== 'undefined' ? window.innerWidth : 1200,
        typeof window !== 'undefined' ? window.innerHeight : 800
      );
      openWindow({ id, type: 'explorer', title: 'Explorer', position: pos, size, minSize: { width: 520, height: 480 } });
    }
    useExplorerStore.getState().queueSearch(id, txid, 'transaction');
    focusWindow(id);
  }, []);

  const onClick = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Clicking a pool node just pins its readout - onMove already set it.
    if (pickNode(e.clientX - rect.left, e.clientY - rect.top)) return;
    const hit = pick(e);
    if (hit) openTx(hit.m.txid);
  }, [pick, pickNode, openTx]);

  // ── Render loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let W = 0;
    let H = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      if (W === 0 || H === 0) return;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (W === 0 || H === 0) { resize(); return; }

      const light = themeRef.current === 'obsidian-light';
      const ink = light ? 'rgba(27,27,31,' : 'rgba(238,236,243,';
      const gold = light ? '#8a6a04' : '#e8b53a';
      const now = performance.now();

      const surge = surgeRef.current;
      if (surge > 0) surgeRef.current = Math.max(0, surge - 0.006);
      const rate = 1 + surge * 2.4;

      const LN = lanesRef.current;

      // ── Geometry ──────────────────────────────────────────────────────
      // Sources: horizontal row across the TOP-LEFT, tubes dropping and entering
      // the funnel VERTICALLY. Destinations: horizontal row across the
      // BOTTOM-RIGHT, fed from the jar's bottom.
      // Source row carries every pool holding value; destinations only the live
      // ones. Params picked by a collision search over the viewport sizes this
      // renders at - see scratchpad/search.ts.
      const SRC = SOURCE_LANES;
      const srcY = 50;
      const srcSpan = W * 0.26;
      const srcX0 = W * 0.075;
      const srcX = (i: number) => srcX0 + (SRC.length === 1 ? 0 : (srcSpan / (SRC.length - 1)) * i);
      const srcSpacing = srcSpan / Math.max(1, SRC.length - 1);

      const jarW = Math.min(250, W * 0.20);
      const jarH = Math.min(240, H * 0.38);
      const jarCX = W * 0.40;
      const jarL = jarCX - jarW / 2;
      const jarR = jarCX + jarW / 2;
      const jarT = H * 0.26;
      const jarB = jarT + jarH;
      const wall = 3;

      const funnelY = jarT - 26;
      // Clamped: on short canvases the bend would otherwise land above the
      // source row and the tubes would run backwards.
      const chuteY = Math.max(srcY + 26, funnelY - 46);

      // Destination row, lower-right.
      const destY = H * 0.82;
      const destX0 = W * 0.60;   // clear of the jar's right edge at every width
      const destSpan = W * 0.28;
      const destX = (i: number) => destX0 + (LN.length === 1 ? 0 : (destSpan / (LN.length - 1)) * i);
      const destSpacing = destSpan / Math.max(1, LN.length - 1);

      // Inner cavity the marbles live in.
      const jar: JarBounds = { left: jarL + wall, right: jarR - wall, top: jarT, bottom: jarB - wall };
      const jarArea = (jar.right - jar.left) * (jar.bottom - jar.top);

      // ── Node radii, area-proportional to real pool balances ───────────
      // The largest pool sets the scale, so t-addr dwarfs the shielded pools
      // exactly as much as it actually does.
      // Each row is scaled by its own largest pool, as large as the row can fit.
      // Area stays proportional above the floor; Sprout is ~550x smaller than
      // transparent so only IT clamps - the exact share is printed on every node.
      const { vals: poolVals, supply: poolSupply } = poolsRef.current;
      const R_FLOOR = 7;
      const R_CAP = 46;
      const srcPeak = Math.max(1, ...SRC.map((l) => poolVals[l] ?? 0));
      const destPeak = Math.max(1, ...LN.map((l) => poolVals[l] ?? 0));
      const srcScale = fitScale(
        SRC, poolVals, srcPeak, srcSpacing,
        srcX0 - 4, jarCX - (srcX0 + srcSpan) - 10, R_FLOOR, R_CAP
      );
      const destScale = fitScale(
        LN, poolVals, destPeak, destSpacing,
        destX0 - jarCX - jarW / 2 - 12, W - (destX0 + destSpan) - 6, R_FLOOR, R_CAP
      );
      const srcR = (lane: Lane) =>
        Math.max(R_FLOOR, srcScale * Math.sqrt(Math.max(poolVals[lane] ?? 0, 1) / srcPeak));
      const destR = (lane: Lane) =>
        Math.max(R_FLOOR, destScale * Math.sqrt(Math.max(poolVals[lane] ?? 0, 1) / destPeak));

      /**
       * Point along a lane's chute. Vertical drop, then an S-curve whose control
       * points are vertical at BOTH ends, so it leaves the source straight down
       * and enters the funnel straight down rather than sliding in sideways.
       */
      const chutePoint = (i: number, t: number): { x: number; y: number } => {
        const x0 = srcX(i);
        if (t < 0.45) {
          const k = t / 0.45;
          return { x: x0, y: srcY + (chuteY - srcY) * k };
        }
        const k = (t - 0.45) / 0.55;
        const mt = 1 - k;
        const d = (funnelY - chuteY) * 0.55;
        const p0y = chuteY, p1y = chuteY + d, p2y = funnelY - d, p3y = funnelY;
        const x = mt * mt * mt * x0 + 3 * mt * mt * k * x0 + 3 * mt * k * k * jarCX + k * k * k * jarCX;
        const y = mt * mt * mt * p0y + 3 * mt * mt * k * p1y + 3 * mt * k * k * p2y + k * k * k * p3y;
        return { x, y };
      };

      /** The same S-curve as a path, for stroking the tube. */
      const strokeChute = (i: number) => {
        const x0 = srcX(i);
        const d = (funnelY - chuteY) * 0.55;
        ctx.beginPath();
        ctx.moveTo(x0, srcY + srcR(SRC[i]));
        ctx.lineTo(x0, chuteY);
        ctx.bezierCurveTo(x0, chuteY + d, jarCX, funnelY - d, jarCX, funnelY);
        ctx.stroke();
      };

      nodesRef.current = [];

      ctx.clearRect(0, 0, W, H);

      // ── Ambient field ─────────────────────────────────────────────────
      const amb = light ? 0.05 : 0.12;
      const drift = now / 5200;
      for (let i = 0; i < 2; i++) {
        const px = W * (0.3 + 0.22 * Math.sin(drift + i * 2.1));
        const py = H * (0.5 + 0.3 * Math.cos(drift * 0.8 + i * 1.4));
        const rad = Math.max(W, H) * (0.36 + 0.06 * Math.sin(drift * 1.3 + i));
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        const tint = i === 0 ? gold : POOL_COLORS.ironwood;
        g.addColorStop(0, `${tint}${Math.round((amb + surge * 0.16) * 255).toString(16).padStart(2, '0')}`);
        g.addColorStop(1, `${tint}00`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      // ── Source row + release chutes ───────────────────────────────────
      SRC.forEach((lane, i) => {
        const x0 = srcX(i);
        const r = srcR(lane);
        ctx.save();
        ctx.lineCap = 'round';

        ctx.strokeStyle = `${LANE_COLOR[lane]}22`;
        ctx.lineWidth = 16;
        strokeChute(i);

        ctx.strokeStyle = `${LANE_COLOR[lane]}55`;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        strokeChute(i);

        ctx.setLineDash([7, 13]);
        ctx.lineDashOffset = -((now / (160 - surge * 105)) % 20);
        ctx.strokeStyle = LANE_COLOR[lane];
        ctx.globalAlpha = 0.35 + surge * 0.4;
        ctx.lineWidth = 3;
        strokeChute(i);
        ctx.restore();

        const sg = ctx.createRadialGradient(x0, srcY, 0, x0, srcY, r * 2);
        sg.addColorStop(0, `${LANE_COLOR[lane]}55`);
        sg.addColorStop(1, `${LANE_COLOR[lane]}00`);
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(x0, srcY, r * 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x0, srcY, r, 0, Math.PI * 2);
        ctx.fillStyle = LANE_COLOR[lane];
        ctx.fill();

        ctx.fillStyle = `${ink}0.8)`;
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(LANE_LABEL[lane], x0, srcY - r - 9);

        if (poolSupply > 0) {
          ctx.fillStyle = `${ink}0.45)`;
          ctx.font = '600 10px Inter, system-ui, sans-serif';
          ctx.fillText(`${(((poolVals[lane] ?? 0) / poolSupply) * 100).toFixed(2)}%`, x0, srcY + r + 14);
        }

        nodesRef.current.push({ lane, x: x0, y: srcY, r, where: 'origin' });
      });

      // ── Outbound rails: jar bottom → destination row ──────────────────
      LN.forEach((lane, i) => {
        const x = destX(i);
        const r = destR(lane);
        // Same casing / core / dash weights as the chutes above the jar, so the
        // two halves read as one piece of plumbing.
        const strokeRail = () => {
          ctx.beginPath();
          ctx.moveTo(jarCX, jarB);
          ctx.bezierCurveTo(jarCX, jarB + 60, x, destY - 70, x, destY - r);
          ctx.stroke();
        };
        ctx.save();
        ctx.lineCap = 'round';

        ctx.strokeStyle = `${LANE_COLOR[lane]}22`;
        ctx.lineWidth = 16;
        strokeRail();

        ctx.strokeStyle = `${LANE_COLOR[lane]}55`;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        strokeRail();

        ctx.setLineDash([7, 13]);
        ctx.lineDashOffset = -((now / (160 - surge * 105)) % 20);
        ctx.strokeStyle = LANE_COLOR[lane];
        ctx.globalAlpha = 0.35 + surge * 0.45;
        ctx.lineWidth = 3;
        strokeRail();
        ctx.restore();

        const glow = ctx.createRadialGradient(x, destY, 0, x, destY, r * 2);
        glow.addColorStop(0, `${LANE_COLOR[lane]}66`);
        glow.addColorStop(1, `${LANE_COLOR[lane]}00`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, destY, r * 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, destY, r, 0, Math.PI * 2);
        ctx.fillStyle = LANE_COLOR[lane];
        ctx.fill();

        ctx.fillStyle = `${ink}0.85)`;
        ctx.font = '600 13px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(LANE_LABEL[lane], x, destY - r - 10);

        // Share of total supply, right on the node.
        if (poolSupply > 0) {
          ctx.fillStyle = `${ink}0.5)`;
          ctx.font = '600 11px Inter, system-ui, sans-serif';
          ctx.fillText(`${(((poolVals[lane] ?? 0) / poolSupply) * 100).toFixed(1)}%`, x, destY + r + 16);
        }

        nodesRef.current.push({ lane, x, y: destY, r, where: 'destination' });
      });

      // ── Release one pending transaction at a time into its chute ───────
      dropClockRef.current += rate;
      if (pendingRef.current.length && dropClockRef.current > 9) {
        dropClockRef.current = 0;
        const t = pendingRef.current.shift()!;
        const lane = laneOf(t);
        chuteRef.current.push({ tx: t, lane, t: 0, wobble: (Math.random() - 0.5) * 5 });
        if (lane === 'sapling' && !lanesRef.current.includes('sapling')) {
          const next: Lane[] = ['transparent', 'sapling', 'orchard', 'ironwood'];
          lanesRef.current = next;
          setLanes(next);
        }
      }

      // ── Slide down the chutes; arrive → drop into the jar ──────────────
      const stillSliding: Chute[] = [];
      for (const c of chuteRef.current) {
        c.t = Math.min(1, c.t + 0.013 * rate);
        const li = Math.max(0, LN.indexOf(c.lane));
        const pt = chutePoint(li, c.t);

        if (c.t >= 1) {
          const bytes = c.tx.size ?? 250;
          marblesRef.current.push({
            txid: c.tx.txid,
            bytes,
            lane: c.lane,
            net: netOf(c.tx, c.lane),
            actions: actionsOf(c.tx, c.lane),
            drains: drainsFrom(c.tx),
            color: LANE_COLOR[c.lane],
            r: radiusForBytes(bytes, BLOCK_CAPACITY_BYTES, jarArea),
            x: jarCX + (Math.random() - 0.5) * (jarW * 0.28),
            y: funnelY + 6,
            vx: (Math.random() - 0.5) * 0.6,
            vy: 1.4,
            restFrames: 0,
          });
          continue;
        }

        const rr = Math.max(3.5, radiusForBytes(c.tx.size ?? 250, BLOCK_CAPACITY_BYTES, jarArea) * 0.85);
        const wob = c.t < 0.55 ? c.wobble : c.wobble * (1 - (c.t - 0.55) / 0.45);
        ctx.globalAlpha = 0.4;
        const cg = ctx.createRadialGradient(pt.x + wob, pt.y, 0, pt.x + wob, pt.y, rr * 2.2);
        cg.addColorStop(0, LANE_COLOR[c.lane]);
        cg.addColorStop(1, `${LANE_COLOR[c.lane]}00`);
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(pt.x + wob, pt.y, rr * 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
        const cb = ctx.createRadialGradient(
          pt.x + wob - rr * 0.35, pt.y - rr * 0.4, rr * 0.08,
          pt.x + wob, pt.y, rr
        );
        cb.addColorStop(0, '#ffffff');
        cb.addColorStop(0.3, LANE_COLOR[c.lane]);
        cb.addColorStop(1, LANE_COLOR[c.lane]);
        ctx.fillStyle = cb;
        ctx.beginPath();
        ctx.arc(pt.x + wob, pt.y, rr, 0, Math.PI * 2);
        ctx.fill();

        stillSliding.push(c);
      }
      chuteRef.current = stillSliding;

      // Radii follow the jar if it resizes.
      for (const m of marblesRef.current) {
        m.r = radiusForBytes(m.bytes, BLOCK_CAPACITY_BYTES, jarArea);
      }

      stepJar(marblesRef.current, jar, 1 + surge * 0.8);

      const seal = sealRef.current;
      if (seal > 0) sealRef.current = Math.max(0, seal - 0.016);

      // ── Jar: back wall, then marbles, then front wall over them ────────
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(jarL, jarT, jarW, jarH, 22);
      ctx.fillStyle = light ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.045)';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(jar.left, jarT - 44, jar.right - jar.left, (jar.bottom - jarT) + 44, [0, 0, 20, 20]);
      ctx.clip();

      for (const m of marblesRef.current) {
        const isHov = hoverRef.current === m.txid;

        const glow = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 2.4);
        glow.addColorStop(0, `${m.color}${Math.round((0.32 + surge * 0.4) * 255).toString(16).padStart(2, '0')}`);
        glow.addColorStop(1, `${m.color}00`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * 2.4, 0, Math.PI * 2);
        ctx.fill();

        // Body lit from the top-left so it reads as a marble, not a flat dot.
        const body = ctx.createRadialGradient(
          m.x - m.r * 0.35, m.y - m.r * 0.4, m.r * 0.08,
          m.x, m.y, m.r
        );
        body.addColorStop(0, '#ffffff');
        body.addColorStop(0.3, m.color);
        body.addColorStop(1, m.color);
        ctx.globalAlpha = isHov ? 1 : 0.95;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = body;
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.lineWidth = isHov ? 2.4 : 1;
        ctx.strokeStyle = isHov ? gold : `${ink}0.25)`;
        ctx.stroke();

        // Turnstile crossings get a ring.
        if (m.net !== 0) {
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = m.net > 0 ? gold : LANE_COLOR.transparent;
          ctx.lineWidth = 1.2;
          ctx.globalAlpha = 0.75;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(jarL, jarT, jarW, jarH, 22);
      ctx.strokeStyle = seal > 0 ? gold : `${ink}0.28)`;
      ctx.lineWidth = seal > 0 ? 3.5 : 2;
      ctx.stroke();
      if (seal > 0) {
        ctx.shadowColor = gold;
        ctx.shadowBlur = 30 * seal;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.restore();

      // ── Destination sight-lines ───────────────────────────────────────
      // A faint straight line from each waiting marble to the pool node it will
      // land in, so you can read where the jar's contents are headed before the
      // block seals. Drawn over the jar wall so it stays traceable.
      ctx.save();
      for (const m of marblesRef.current) {
        const isHov = hoverRef.current === m.txid;
        const li = Math.max(0, LN.indexOf(m.lane));
        ctx.globalAlpha = (isHov ? 0.55 : 0.11) * (0.65 + surge * 0.35);
        ctx.strokeStyle = LANE_COLOR[m.lane];
        ctx.lineWidth = isHov ? 1.8 : 1;
        ctx.setLineDash([3, 5]);
        ctx.lineDashOffset = -((now / 95) % 8);
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(destX(li), destY - destR(m.lane));
        ctx.stroke();
      }
      ctx.restore();

      // Labels.
      // Title sits beside the jar, clear of the chutes and the drain fan.
      ctx.textAlign = 'left';
      ctx.fillStyle = seal > 0 ? gold : `${ink}0.5)`;
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      ctx.fillText(seal > 0 ? 'SEALED' : 'NEXT BLOCK', jarR + 18, jarT + 22);
      ctx.font = '700 19px Inter, system-ui, sans-serif';
      ctx.fillStyle = `${ink}0.9)`;
      ctx.fillText(heightRef.current ? `#${(heightRef.current + 1).toLocaleString()}` : '-', jarR + 18, jarT + 46);

      ctx.fillStyle = `${ink}0.42)`;
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('MEMPOOL - WAITING TO BE MINED', srcX0 - 12, H - 10);

      // ── Draining transactions ─────────────────────────────────────────
      const remaining: Drain[] = [];
      for (const d of drainsRef.current) {
        d.t = Math.min(1, d.t + 0.011 * rate);
        const li = Math.max(0, LN.indexOf(d.lane));
        const tx = destX(li);
        const ty = destY - destR(d.lane);
        const k = d.t;
        const mt = 1 - k;
        const cx1 = jarCX, cy1 = jarB + 60;
        const cx2 = tx, cy2 = destY - 70;
        const x = mt * mt * mt * d.fromX + 3 * mt * mt * k * cx1 + 3 * mt * k * k * cx2 + k * k * k * tx;
        const y = mt * mt * mt * d.fromY + 3 * mt * mt * k * cy1 + 3 * mt * k * k * cy2 + k * k * k * ty;

        const a = 1 - Math.max(0, (d.t - 0.82) / 0.18);
        ctx.globalAlpha = a * 0.35;
        const g2 = ctx.createRadialGradient(x, y, 0, x, y, d.r * 2.2);
        g2.addColorStop(0, LANE_COLOR[d.lane]);
        g2.addColorStop(1, `${LANE_COLOR[d.lane]}00`);
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(x, y, d.r * 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = LANE_COLOR[d.lane];
        ctx.fill();
        ctx.globalAlpha = 1;

        if (d.t < 1) remaining.push(d);
      }
      drainsRef.current = remaining;

      // Seal sweep.
      if (seal > 0) {
        const sweepX = W * (1 - seal) * 1.25 - W * 0.1;
        const sw = ctx.createLinearGradient(sweepX - 130, 0, sweepX + 130, 0);
        sw.addColorStop(0, `${gold}00`);
        sw.addColorStop(0.5, `${gold}${Math.round(seal * 60).toString(16).padStart(2, '0')}`);
        sw.addColorStop(1, `${gold}00`);
        ctx.fillStyle = sw;
        ctx.fillRect(0, 0, W, H);
      }
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const fillPct = (stats.bytes / BLOCK_CAPACITY_BYTES) * 100;
  const totalSettled = Object.values(laneTotals).reduce((a, b) => a + b, 0);

  const generative = useGenerative();

  /*
   * Settlement as a LANDSCAPE, not a sea.
   *
   * The subject here is a direction of travel: value leaves the source pools,
   * collects in the next block, and is paid out to the pools that can receive.
   * Ripples said none of that - they were the same in every direction. Terrain
   * does say it, because terrain has a downhill.
   *
   *   TOP     source pools stand as high ground, height by what they still hold
   *   MIDDLE  the next block, a basin that fills as it fills
   *   BOTTOM  the destinations, lower still, deepening as value settles in
   *
   * Contours read as a survey map: tight banding is a steep drop, wide banding
   * is flat. Markers run down the gradient, so the way the ground falls IS the
   * way the money goes. Nothing has to be labelled "flow" - you can see it.
   */
  const topoOpts: plot.TopoOpts = useMemo(() => {
    const pools = chain?.pools;
    const held = (l: Lane) => Math.max(0, Number((pools as Record<string, number> | undefined)?.[l] ?? 0));
    const totalHeld = Math.max(1e-9, SOURCE_LANES.reduce((n, l) => n + held(l), 0));

    const features: plot.TopoFeature[] = SOURCE_LANES.map((l, i) => ({
      x: (i + 0.5) / SOURCE_LANES.length,
      y: 0.14,
      // Square-rooted so a dominant pool is visibly higher without flattening
      // every other one into the plain.
      height: 0.35 + 0.85 * Math.sqrt(held(l) / totalHeld),
      radius: 0.30,
      colour: packColour(LANE_COLOR[l]),
    }));

    /*
     * The block: a basin in the middle of the map that RISES as it fills.
     *
     * Empty block, deep hollow; full block, nearly level with the ground around
     * it. That is the read the marble jar gave and it is the one number people
     * actually watch, so it gets the centre of the map.
     */
    features.push({
      x: 0.5,
      y: 0.5,
      height: -0.95 + 0.85 * Math.min(1, fillPct / 100),
      radius: 0.34,
      colour: packColour('--accent-gold', '#f4b728'),
    });

    // Only these can receive: Orchard is closed to new value, and Sprout and
    // Sapling can only drain.
    const dests: Lane[] = ['transparent', 'ironwood'];
    const totalDest = Math.max(1e-9, dests.reduce((n, l) => n + (laneTotals[l] ?? 0), 0));
    dests.forEach((l, i) => features.push({
      x: (i + 0.5) / dests.length,
      y: 0.88,
      // Deeper the more has settled there, so the ground keeps falling toward
      // whichever destination is winning.
      height: -(0.45 + 0.75 * Math.sqrt((laneTotals[l] ?? 0) / totalDest)),
      radius: 0.30,
      colour: packColour(LANE_COLOR[l]),
    }));

    return { features, bands: 15, drift: 0.03, flow: true, flowSpeed: 0.34 };
  }, [chain, laneTotals, fillPct]);

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="shrink-0 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Sources across the top are every pool still holding ZEC, sized by how much (hover for the
        exact share). <span className="text-[var(--text-primary)]">Sprout, Sapling and Orchard can
        only drain</span> - Orchard is closed to new value, so everything in it leaves through a
        turnstile, which is why only t-addr and Ironwood appear as destinations. Unconfirmed
        transactions drop into the next block like marbles into a jar. A marble&apos;s{' '}
        <span className="text-[var(--text-primary)]">area is its byte size</span> measured against
        the {fmtBytes(BLOCK_CAPACITY_BYTES)} consensus block cap, so the pile is a real read of how
        full the next block is - not a flattering rescale. <Colour word="Colour" /> is the pool it will settle into.
        Hover a marble for detail, click to open it in the Explorer.
      </p>

      <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: 'Waiting', value: `${stats.count} tx` },
          { label: 'Mempool size', value: fmtBytes(stats.bytes) },
          {
            label: 'Of block capacity',
            value: stats.bytes > 0 && fillPct < 0.01 ? '<0.01%' : `${fillPct.toFixed(2)}%`,
          },
          { label: 'Settled this session', value: `${totalSettled}` },
        ].map((s) => (
          <div key={s.label} className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-3 py-2">
            <div className="text-[11px] text-[var(--text-muted)]">{s.label}</div>
            <div className="text-[17px] text-[var(--text-primary)]">{s.value}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="shrink-0 rounded-[var(--radius-sm)] px-3 py-2 text-[12px] text-[var(--accent-orange)]">
          {error}
        </div>
      )}

      <div
        ref={wrapRef}
        className="relative min-h-[380px] flex-1 overflow-hidden rounded-[var(--radius-md)]"
        style={{ background: 'var(--viz-bg)' }}
      >
        {generative && (
          <>
            <GlyphSea topo={topoOpts} summary={
              `Live settlement: ${stats.count} unconfirmed transactions, `
              + `${fillPct.toFixed(0)} percent of the next block filled.`
            } />
            {/*
              * The legend. A survey map is unreadable without one, and this is
              * the half that makes the landscape mean something: which high
              * ground is which pool, how deep the block is right now, and where
              * the value is actually landing.
              */}
            <div className="pointer-events-none absolute inset-0"
              style={{ fontFamily: 'monospace' }}>
              {SOURCE_LANES.map((l, i) => {
                const held = Number((chain?.pools as Record<string, number> | undefined)?.[l] ?? 0);
                return (
                  <div key={`s-${l}`} style={{
                    position: 'absolute', left: `${((i + 0.5) / SOURCE_LANES.length) * 100}%`,
                    top: '3%', transform: 'translateX(-50%)', textAlign: 'center',
                    fontSize: 11, lineHeight: 1.35, whiteSpace: 'nowrap',
                    textShadow: '0 1px 5px rgba(0,0,0,.95), 0 0 3px rgba(0,0,0,.95)',
                  }}>
                    <div style={{ color: LANE_COLOR[l], fontWeight: 700 }}>▲ {l}</div>
                    <div style={{ color: 'var(--text-primary)' }}>{fmtCompact(held)}</div>
                  </div>
                );
              })}

              {/* The block, dead centre, where the basin is. */}
              <div style={{
                position: 'absolute', left: '50%', top: '50%',
                transform: 'translate(-50%, -50%)', textAlign: 'center',
                fontSize: 11, lineHeight: 1.4, whiteSpace: 'nowrap',
                textShadow: '0 1px 5px rgba(0,0,0,.95), 0 0 3px rgba(0,0,0,.95)',
              }}>
                <div style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>
                  ▼ next block
                </div>
                <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
                  {fillPct.toFixed(0)}% full
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                  {stats.count} tx · {fmtBytes(stats.bytes)}
                </div>
              </div>

              {(['transparent', 'ironwood'] as Lane[]).map((l, i) => (
                <div key={`d-${l}`} style={{
                  position: 'absolute', left: `${((i + 0.5) / 2) * 100}%`, bottom: '3%',
                  transform: 'translateX(-50%)', textAlign: 'center',
                  fontSize: 11, lineHeight: 1.35, whiteSpace: 'nowrap',
                  textShadow: '0 1px 5px rgba(0,0,0,.95), 0 0 3px rgba(0,0,0,.95)',
                }}>
                  <div style={{ color: LANE_COLOR[l], fontWeight: 700 }}>▼ {l}</div>
                  <div style={{ color: 'var(--text-primary)' }}>{fmtCompact(laneTotals[l] ?? 0)}</div>
                </div>
              ))}

              {/* What the marks mean. Without this the contours are decoration. */}
              <div style={{
                position: 'absolute', left: 8, bottom: 6, fontSize: 10, lineHeight: 1.5,
                color: 'var(--text-muted)',
                textShadow: '0 1px 4px rgba(0,0,0,.95)',
              }}>
                <div>contour = equal height · tight bands = steep</div>
                <div>marks run downhill, the way value moves</div>
              </div>
            </div>
          </>
        )}
        {/* Hidden, not unmounted: the physics sim keeps its marbles so
            toggling back does not empty the jar. */}
        <canvas
          ref={canvasRef}
          className="block"
          style={{ cursor: hover ? 'pointer' : 'default', touchAction: 'none',
                   ...(generative ? { visibility: 'hidden' as const } : null) }}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          onPointerDown={onClick}
        />

        {hover && (
          <div
            className="pointer-events-none absolute z-10 px-3 py-2"
            style={{
              left: Math.min(hover.x + 16, Math.max(0, (wrapRef.current?.clientWidth ?? 0) - 240)),
              top: Math.max(6, hover.y - 80),
              width: 224,
              borderRadius: 'var(--md-shape-sm)',
              background: 'var(--bg-window)',
              boxShadow: 'var(--md-elev-3)',
            }}
          >
            {hover.kind === 'pool' ? (
              <>
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-primary)]">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: LANE_COLOR[hover.lane] }} />
                  {LANE_LABEL[hover.lane]}
                </div>
                <div className="mt-1 text-[17px] text-[var(--text-primary)]">
                  {hover.pct.toFixed(2)}%
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">of all ZEC in existence</div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  {fmtCompact(hover.held)} ZEC held
                </div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Node size is area-proportional to this.
                </div>
              </>
            ) : (
              <>
                <div className="truncate font-[var(--font-mono)] text-[11px] text-[var(--text-primary)]">
                  {hover.txid.slice(0, 20)}…
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: LANE_COLOR[hover.lane] }} />
                  {LANE_LABEL[hover.lane]}
                  {hover.actions > 0 && <span>· {hover.actions} act</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                  {fmtBytes(hover.bytes)} ·{' '}
                  <span className="text-[var(--text-secondary)]">
                    {((hover.bytes / BLOCK_CAPACITY_BYTES) * 100).toFixed(3)}% of a block
                  </span>
                </div>
                {hover.drains.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--text-muted)]">
                    <span>draining</span>
                    {hover.drains.map((d) => (
                      <span key={d.lane} className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: LANE_COLOR[d.lane] }} />
                        {LANE_LABEL[d.lane]} {d.actions}
                      </span>
                    ))}
                  </div>
                )}
                {hover.net !== 0 && (
                  <div className="mt-0.5 text-[11px]" style={{ color: 'var(--accent-gold)' }}>
                    {hover.net > 0 ? '+' : ''}{hover.net.toFixed(4)} ZEC across the turnstile
                  </div>
                )}
                <div className="mt-1 text-[10px] text-[var(--accent-blue)]">click to open in Explorer</div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-3">
        {lanes.map((lane) => (
          <span key={lane} className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: LANE_COLOR[lane] }} />
            {LANE_LABEL[lane]}
            <span className="text-[var(--text-secondary)]">{fmtCompact(laneTotals[lane] ?? 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default LiveSettlement;
