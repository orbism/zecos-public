'use client';

import { useId } from 'react';
import { APP_META } from '@/config/appMeta';
import { getIcon, useSettingsStore } from '@/store/settingsStore';
import { ZEC_ICONS, GLYPH_ICONS, LOGO_IDS, TONES, type Prim } from './zecIcons';

/** One ZEC-OS icon, by id: the dark tile, the gold line, its glow. Null if there is no drawing. */
export function ZecIcon({ id, size = 32, title, tile = true, folder = false }: { id: string; size?: number; title?: string; tile?: boolean;
  /** Drawn as a folder: the tile takes a tab and a thin gold outline, and the mark sits in its body. */
  folder?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const prims = ZEC_ICONS[id];
  if (!prims) return null;
  const grad = `zg-${uid}`;
  const stroke = (q: Extract<Prim, { k: 'p' | 'c' }>, glow: boolean) => ({
    fill: 'none', stroke: `url(#${grad})`, strokeWidth: glow ? q.w * 2.4 : q.w,
    opacity: (q.o ?? 1) * (glow ? 0.16 : 1),
  });
  const layer = (glow: boolean) => prims.map((q, i) => {
    if (q.k === 'p' && q.w > 0) return <path key={i} d={q.d} {...stroke(q, glow)} />;
    if (q.k === 'c') return <circle key={i} cx={q.x} cy={q.y} r={q.r} {...stroke(q, glow)} />;
    if (glow) return null;
    if (q.k === 'f') return <path key={i} d={q.d} fill={TONES[q.tone]} opacity={q.o ?? 1} />;
    if (q.k === 'd') return <circle key={i} cx={q.x} cy={q.y} r={q.r} fill={TONES[q.tone]} opacity={q.o ?? 1} />;
    if (q.k === 't') return (
      <text key={i} x={q.x} y={q.y} fontSize={q.size} fill={TONES[q.tone]} textAnchor="middle"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontWeight={700}>{q.s}</text>
    );
    return null;
  });
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      {title && <title>{title}</title>}
      <defs>
        {/* copper at the foot of the stroke, gold at its head: the Pool Traffic line */}
        <linearGradient id={grad} x1="10" y1="54" x2="54" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={TONES.copper} />
          <stop offset="0.55" stopColor={TONES.amber} />
          <stop offset="1" stopColor={TONES.gold} />
        </linearGradient>
      </defs>
      {tile && !folder && <rect width="64" height="64" rx="10.24" fill={TONES.ink} />}
      {folder && <path d={FOLDER_TILE} fill={TONES.ink} stroke={`url(#${grad})`} strokeWidth={1.8} strokeLinejoin="round" />}
      <g strokeLinecap="round" strokeLinejoin="round" transform={folder ? 'translate(32 39) scale(0.7) translate(-32 -32)' : undefined}>
        {layer(true)}
        {layer(false)}
      </g>
    </svg>
  );
}

/** A folder: a tab on the left, the body below it, corners softened. */
const FOLDER_TILE = 'M5 9.5Q5 7 7.5 7H22Q24 7 25.3 8.5L28.7 12.5Q30 14 32 14H56.5Q59 14 59 16.5V54.5Q59 57 56.5 57H7.5Q5 57 5 54.5Z';

const META = new Map(APP_META.map((a) => [a.id, a]));

/**
 * An app's (or folder's, or menu action's) icon, wherever one is shown.
 *
 * Retro icons win: that setting is a deliberate choice about how the whole
 * desktop looks, so it keeps its text glyphs. Otherwise an app with its own
 * logo shows that, and everything else its golden ZEC-OS mark; the emoji is
 * the last resort, for anything not drawn yet.
 */
export function AppGlyph({ id, glyph, size = 32, retro: retroProp, title, folder }: { id?: string; glyph?: string; size?: number; retro?: boolean; title?: string; folder?: boolean }) {
  // callers that already read the setting pass it; the rest get it from the store
  const retroStored = useSettingsStore((s) => s.retroIcons);
  const retro = retroProp ?? retroStored;
  const meta = id ? META.get(id) : undefined;
  const g = glyph ?? meta?.icon ?? '';
  if (retro) return <>{getIcon(g, true)}</>;
  if (id && LOGO_IDS.has(id) && meta?.logo) return <img src={meta.logo} alt="" width={size} height={size} style={{ borderRadius: size * 0.16, display: 'inline-block', verticalAlign: 'middle' }} />;
  const key = id && ZEC_ICONS[id] ? id : GLYPH_ICONS[g];
  if (key) return <ZecIcon id={key} size={size} title={title} folder={folder} />;
  return <>{g}</>;
}
