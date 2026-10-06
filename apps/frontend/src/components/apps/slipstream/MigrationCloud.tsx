'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { usePoolsHistory } from '@/hooks/useZecData';
import { POOL_COLORS, POOL_LABELS, SHIELDED_POOLS, type ShieldedPool } from '@/config/pools';
import { AppLoader } from '@/components/ui/AppLoader';
import { fmtCompact, poolValues, shieldedTotal } from './shared';
import { plot } from '@/lib/generative/engine';
import { useGenerative } from '@/lib/generative/useGenerative';
import { GlyphSea } from '@/lib/generative/GlyphSea';
import { packColour } from '@/lib/generative/GlyphField';

// One dot represents this much ZEC. Chosen so the whole shielded set is a few
// thousand points - dense enough to read as a cloud, cheap enough for one draw call.
const ZEC_PER_DOT = 1_000;
const MAX_DOTS = 12_000; // hard ceiling; guards against a supply spike
const CLOUD_RADIUS = 3.2;
const RING_RADIUS = 7.5;

// Ironwood is days old, so the short ranges matter more than the long ones here.
// 1d/3d/7d come back hourly from the pools route; the rest are daily.
const RANGES = ['1d', '3d', '7d', '1m', '3m', '1y', 'all'] as const;
type Range = (typeof RANGES)[number];

// Frame duration per range - long ranges have hundreds of points and would blur
// past at a fixed rate; short ones have few and need dwelling on.
const HOURLY = new Set<Range>(['1d', '3d', '7d']);

const FRAME_MS: Record<Range, number> = {
  '1d': 220, '3d': 200, '7d': 180, '1m': 140, '3m': 110, '1y': 80, 'all': 55,
};

/** Fixed cloud centre per pool - a ring on the XZ plane, Ironwood at the front. */
const POOL_CENTRES: Record<ShieldedPool, THREE.Vector3> = {
  ironwood: new THREE.Vector3(0, 0, RING_RADIUS),
  orchard: new THREE.Vector3(RING_RADIUS, 0, 0),
  sapling: new THREE.Vector3(0, 0, -RING_RADIUS),
  sprout: new THREE.Vector3(-RING_RADIUS, 0, 0),
};

// Pools are filled in this order, so as one shrinks and another grows the dots
// on the boundary migrate between clouds - that IS the migration being shown.
const FILL_ORDER: ShieldedPool[] = ['sprout', 'sapling', 'orchard', 'ironwood'];

export function MigrationCloud() {
  const [range, setRange] = useState<Range>('7d');
  const { data: history, loading, error } = usePoolsHistory(range);

  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);

  const mountRef = useRef<HTMLDivElement>(null);
  // Target pool index per dot for the current frame - read by the render loop.
  const targetsRef = useRef<Int8Array>(new Int8Array(0));
  const frameRef = useRef(0);

  // The scene picks its blend mode from the active theme, so it has to rebuild
  // when the standalone light/dark toggle flips.
  const [themeId, setThemeId] = useState<string>('');
  useEffect(() => {
    const read = () => setThemeId(document.documentElement.getAttribute('data-theme') ?? '');
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  const frames = history?.length ?? 0;

  // Dot budget from the largest shielded total across the series.
  const dotCount = useMemo(() => {
    if (!history?.length) return 0;
    const peak = history.reduce((m, p) => Math.max(m, shieldedTotal(p)), 0);
    return Math.min(MAX_DOTS, Math.ceil(peak / ZEC_PER_DOT));
  }, [history]);

  // Clamp the scrubber when the series length changes (range switch).
  useEffect(() => {
    setFrame((f) => (frames === 0 ? 0 : Math.min(f, frames - 1)));
  }, [frames]);

  // Recompute each dot's target pool for the visible frame.
  useEffect(() => {
    if (!history?.length || dotCount === 0) return;
    const point = history[Math.min(frame, history.length - 1)];
    const vals = poolValues(point);

    const targets = new Int8Array(dotCount).fill(-1); // -1 = unused (hidden)
    let cursor = 0;
    for (const pool of FILL_ORDER) {
      const need = Math.round((vals[pool] || 0) / ZEC_PER_DOT);
      const end = Math.min(dotCount, cursor + need);
      targets.fill(FILL_ORDER.indexOf(pool), cursor, end);
      cursor = end;
      if (cursor >= dotCount) break;
    }
    targetsRef.current = targets;
    frameRef.current = frame;
  }, [history, frame, dotCount]);

  // Playback
  useEffect(() => {
    if (!playing || frames < 2) return;
    const id = setInterval(() => {
      setFrame((f) => (f + 1 >= frames ? 0 : f + 1));
    }, FRAME_MS[range]);
    return () => clearInterval(id);
  }, [playing, frames, range]);

  // ── three.js scene ─────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || dotCount === 0) return;

    // Additive blending sums toward white, so on a light surface every dot
    // washes out. Fall back to normal blending (and opaque dots) in light mode.
    const lightMode = themeId === 'obsidian-light';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // One BufferGeometry + one Points = a single draw call for every dot.
    const positions = new Float32Array(dotCount * 3);
    const colors = new Float32Array(dotCount * 3);
    // Stable per-dot offset inside its cloud, so dots don't shimmer frame to frame.
    const offsets = new Float32Array(dotCount * 3);

    for (let i = 0; i < dotCount; i++) {
      // Uniform-ish point in a sphere
      const u = Math.random();
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = CLOUD_RADIUS * Math.cbrt(u);
      offsets[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      offsets[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6; // flatten slightly
      offsets[i * 3 + 2] = r * Math.cos(phi);
      positions[i * 3] = offsets[i * 3];
      positions[i * 3 + 1] = -60; // start hidden below
      positions[i * 3 + 2] = offsets[i * 3 + 2];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: lightMode ? 0.19 : 0.16,
      vertexColors: true,
      transparent: true,
      opacity: lightMode ? 1 : 0.92,
      sizeAttenuation: true,
      depthWrite: false,
      blending: lightMode ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const poolColorVecs = FILL_ORDER.map((p) => new THREE.Color(POOL_COLORS[p]));
    const hidden = new THREE.Vector3(0, -60, 0);

    // Hand-rolled orbit (drag to rotate, wheel to zoom) - avoids pulling in
    // OrbitControls for ~20 lines of behaviour.
    let yaw = 0.6;
    let pitch = 0.38;
    let dist = 24;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      yaw -= (e.clientX - lastX) * 0.006;
      pitch = Math.max(-1.3, Math.min(1.3, pitch + (e.clientY - lastY) * 0.006));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      dist = Math.max(12, Math.min(48, dist + e.deltaY * 0.02));
    };

    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    // updateStyle:true so the canvas' CSS box always matches its buffer - with
    // it off, a first measurement of 0x0 left the canvas stuck at the 300x150
    // default and the cloud effectively off-screen until something forced a
    // resize (which is why it only appeared once you dragged).
    let sized = false;
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      sized = true;
      renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const target = new THREE.Vector3();
    let raf = 0;
    // First frame with real targets snaps dots straight to their pool and colour
    // instead of easing in. Colours zero-init to black, which is invisible under
    // additive blending, and positions start off-frustum - so without this the
    // cloud spent its first second looking like an empty box.
    let seeded = false;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!sized) resize();

      camera.position.set(
        Math.cos(pitch) * Math.sin(yaw) * dist,
        Math.sin(pitch) * dist,
        Math.cos(pitch) * Math.cos(yaw) * dist
      );
      camera.lookAt(0, 0, 0);

      const targets = targetsRef.current;
      const pos = geometry.attributes.position.array as Float32Array;
      const col = geometry.attributes.color.array as Float32Array;
      const snap = !seeded && targets.length > 0;
      if (snap) seeded = true;

      for (let i = 0; i < dotCount; i++) {
        const t = i < targets.length ? targets[i] : -1;
        if (t < 0) {
          target.copy(hidden);
        } else {
          const centre = POOL_CENTRES[FILL_ORDER[t]];
          target.set(
            centre.x + offsets[i * 3],
            centre.y + offsets[i * 3 + 1],
            centre.z + offsets[i * 3 + 2]
          );
          const c = poolColorVecs[t];
          if (snap) {
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
          } else {
            // Ease colour alongside position so a migrating dot changes hue in flight.
            col[i * 3] += (c.r - col[i * 3]) * 0.08;
            col[i * 3 + 1] += (c.g - col[i * 3 + 1]) * 0.08;
            col[i * 3 + 2] += (c.b - col[i * 3 + 2]) * 0.08;
          }
        }

        if (snap) {
          pos[i * 3] = target.x; pos[i * 3 + 1] = target.y; pos[i * 3 + 2] = target.z;
        } else {
          pos[i * 3] += (target.x - pos[i * 3]) * 0.07;
          pos[i * 3 + 1] += (target.y - pos[i * 3 + 1]) * 0.07;
          pos[i * 3 + 2] += (target.z - pos[i * 3 + 2]) * 0.07;
        }
      }

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [dotCount, themeId]);

  const point = history?.[Math.min(frame, (history?.length ?? 1) - 1)];
  const vals = point ? poolValues(point) : null;

  const generative = useGenerative();

  /*
   * The migration as a surface: one swell per pool, sized by its balance at the
   * frame on screen, with wave trains running along the routes value actually
   * takes - Sprout and Sapling into Orchard, Orchard into Ironwood.
   *
   * The trains carry the DESTINATION's colour, because a wave arriving in
   * Ironwood is Ironwood's gain. Where the inbound trains meet at a pool they
   * interfere, which is what a pool absorbing from two sources at once looks
   * like.
   */
  const seaOpts: plot.SeaOpts = useMemo(() => {
    if (!vals) return { motion: 'radial', origin: { x: 0.5, y: 0.5 }, speed: 0.08, ambient: 0.24 };
    const total = Math.max(1e-9, vals.sprout + vals.sapling + vals.orchard + vals.ironwood);
    const at: Record<string, { x: number; y: number }> = {
      sprout:   { x: 0.16, y: 0.24 },
      sapling:  { x: 0.16, y: 0.74 },
      orchard:  { x: 0.55, y: 0.50 },
      ironwood: { x: 0.87, y: 0.50 },
    };
    const keys = ['sprout', 'sapling', 'orchard', 'ironwood'] as const;
    const sources = keys.map((k) => ({
      ...at[k]!,
      r: 0.05 + 0.22 * Math.sqrt(vals[k] / total),
      strength: 0.35 + 0.6 * (vals[k] / total),
      colour: packColour(POOL_COLORS[k]),
    }));
    const route = (from: typeof keys[number], to: typeof keys[number]) => ({
      from: at[from]!, to: at[to]!,
      width: 0.05,
      strength: 0.45 + 0.5 * (vals[to] / total),
      colour: packColour(POOL_COLORS[to]),
    });
    return {
      sources,
      links: [route('sprout', 'orchard'), route('sapling', 'orchard'), route('orchard', 'ironwood')],
      motion: 'linear',
      dir: 0,
      speed: 0.11,
      ambient: 0.24,
    };
  }, [vals]);
  const total = point ? shieldedTotal(point) : 0;
  const stamp = point ? new Date(Number(point.timestamp)) : null;

  if (error) {
    return <div className="p-4 text-[13px] text-[var(--accent-orange)]">Migration data unavailable: {error}</div>;
  }
  if (loading && !history) return <AppLoader />;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-[var(--radius-sm)] border px-2.5 py-1 text-[12px] transition-colors ${
              range === r
                ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]'
                : 'border-[var(--border-light)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {r.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() => setPlaying((p) => !p)}
          className="ml-auto rounded-[var(--radius-sm)] border border-[var(--border-light)] px-2.5 py-1 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-gold)]"
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      </div>

      {generative && (
        <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-window)]">
          <GlyphSea
            opts={seaOpts}
            summary={'Pool migration: value moving from Sprout and Sapling into Orchard, and from Orchard into Ironwood.'}
          />
          {/* Names over the swells, so a pool is identifiable. */}
          <div className="pointer-events-none absolute inset-0">
            {([['Sprout', 0.16, 0.24, POOL_COLORS.sprout], ['Sapling', 0.16, 0.74, POOL_COLORS.sapling],
               ['Orchard', 0.55, 0.50, POOL_COLORS.orchard], ['Ironwood', 0.87, 0.50, POOL_COLORS.ironwood]] as const)
              .map(([name, x, y, c]) => (
                <div key={name} style={{
                  position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`,
                  transform: 'translate(-50%, -50%)', textAlign: 'center',
                  fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap',
                  textShadow: '0 1px 4px rgba(0,0,0,.92), 0 0 3px rgba(0,0,0,.95)',
                }}>
                  <div style={{ color: c, fontWeight: 700 }}>{name}</div>
                  {vals && (
                    <div style={{ color: 'var(--text-primary)' }}>
                      {fmtCompact(vals[name.toLowerCase() as 'sprout'])}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
      <div
        ref={mountRef}
        style={generative ? { display: 'none' } : undefined}
        className="relative min-h-[280px] flex-1 cursor-grab overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-window)] bg-[var(--viz-bg)] active:cursor-grabbing"
      >
        <div className="pointer-events-none absolute top-3 left-3 text-[11px] text-[var(--text-muted)]">
          drag to orbit · scroll to zoom
        </div>
        <div className="pointer-events-none absolute right-3 bottom-3 text-right">
          <div className="text-[11px] text-[var(--text-muted)]">
            1 dot = {fmtCompact(ZEC_PER_DOT)} ZEC
          </div>
          <div className="text-[13px] text-[var(--text-primary)]">
            {stamp
              ? HOURLY.has(range)
                ? stamp.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true })
                : stamp.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
              : '-'}
          </div>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, frames - 1)}
        value={frame}
        onChange={(e) => {
          setPlaying(false);
          setFrame(Number(e.target.value));
        }}
        className="w-full accent-[var(--accent-gold)]"
        aria-label="Timeline"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SHIELDED_POOLS.map((p) => {
          const v = vals?.[p] ?? 0;
          const pct = total > 0 ? (v / total) * 100 : 0;
          return (
            <div
              key={p}
              className="rounded-[var(--radius-sm)] border border-[var(--border-window)] bg-[var(--bg-inset)] px-3 py-2"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: POOL_COLORS[p] }}
                />
                <span className="text-[12px] text-[var(--text-muted)]">{POOL_LABELS[p]}</span>
              </div>
              <div className="text-[15px] text-[var(--text-primary)]">{fmtCompact(v)}</div>
              <div className="text-[11px] text-[var(--text-muted)]">{pct.toFixed(1)}% of shielded</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MigrationCloud;
