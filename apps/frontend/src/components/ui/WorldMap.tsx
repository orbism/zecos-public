'use client';

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Geometry } from 'geojson';

/**
 * A small world map in plain SVG: Natural Earth 1:110m country shapes
 * (world-atlas), drawn with a simple equirectangular projection cropped to
 * 60°S to 85°N. Pins by latitude and longitude; clicking the map reports the
 * point (for "pick a location").
 */

const W = 1000, H = 450, TOP = 85, BOTTOM = -60;
export const project = (lng: number, lat: number): [number, number] => [((lng + 180) / 360) * W, ((TOP - lat) / (TOP - BOTTOM)) * H];
const unproject = (x: number, y: number): [number, number] => [(x / W) * 360 - 180, TOP - (y / H) * (TOP - BOTTOM)];

type Countries = { name: string; d: string }[];
let cache: Promise<Countries> | null = null;

function ringPath(ring: number[][]): string {
  let d = '', px = 0;
  ring.forEach(([lng, lat], i) => {
    const [x, y] = project(lng!, lat!);
    // a jump across the antimeridian would draw a line across the whole map
    d += (i === 0 || Math.abs(x - px) > W / 2 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    px = x;
  });
  return d + 'Z';
}

function load(): Promise<Countries> {
  return (cache ??= import('world-atlas/countries-110m.json').then((m) => {
    const topo = (m.default ?? m) as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    const fc = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>;
    return fc.features.map((f) => {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      return { name: f.properties.name, d: polys.flatMap((p) => p.map(ringPath)).join('') };
    }).filter((c) => c.d);
  }));
}

/** Country names, in the spelling the map uses. */
export function useCountryNames(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => { void load().then((c) => setNames(c.map((x) => x.name).sort((a, b) => a.localeCompare(b)))); }, []);
  return names;
}

export interface Pin { id: string; lat: number; lng: number; label: string; tone?: string }

export function WorldMap({ pins = [], highlight, onPick, onPin, picked }: {
  pins?: Pin[];
  /** Country to fill (by name). */
  highlight?: string | null;
  /** Click anywhere: the point, in degrees. */
  onPick?: (lat: number, lng: number) => void;
  onPin?: (id: string) => void;
  picked?: { lat: number; lng: number } | null;
}) {
  const [countries, setCountries] = useState<Countries>([]);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => { void load().then(setCountries); }, []);

  const click = (e: MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [lng, lat] = unproject(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
    onPick(Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4);
  };
  const pinXY = useMemo(() => pins.map((p) => ({ ...p, xy: project(p.lng, p.lat) })), [pins]);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ background: 'var(--bg-inset)', borderRadius: 10, cursor: onPick ? 'crosshair' : 'default' }} onClick={click}>
        {countries.map((c) => (
          <path key={c.name} d={c.d} onMouseEnter={() => setHover(c.name)} onMouseLeave={() => setHover(null)}
            fill={c.name === highlight ? 'color-mix(in srgb, var(--accent-gold) 35%, transparent)' : c.name === hover ? 'color-mix(in srgb, var(--accent-gold) 14%, transparent)' : 'color-mix(in srgb, var(--text-muted) 16%, transparent)'}
            stroke="color-mix(in srgb, var(--text-muted) 45%, transparent)" strokeWidth={0.5} />
        ))}
        {pinXY.map((p) => (
          <g key={p.id} onClick={(e) => { e.stopPropagation(); onPin?.(p.id); }} style={{ cursor: onPin ? 'pointer' : undefined }}>
            <title>{p.label}</title>
            <circle cx={p.xy[0]} cy={p.xy[1]} r={7} fill={p.tone ?? 'var(--accent-gold)'} opacity={0.25} />
            <circle cx={p.xy[0]} cy={p.xy[1]} r={3.5} fill={p.tone ?? 'var(--accent-gold)'} stroke="#000" strokeWidth={0.8} />
          </g>
        ))}
        {picked && (() => { const [x, y] = project(picked.lng, picked.lat); return <path d={`M${x} ${y}l-6 -14a6 6 0 1 1 12 0z`} fill="var(--accent-orange)" stroke="#000" strokeWidth={0.8} />; })()}
      </svg>
      {hover && <div className="absolute left-2 bottom-2 px-2 py-0.5 text-[var(--text-secondary)]" style={{ fontSize: 11, background: 'var(--bg-window)', borderRadius: 6 }}>{hover}</div>}
    </div>
  );
}
