'use client';

import type { ReactNode } from 'react';

/**
 * Cards and tags for the reference apps (Exchange Checker, Rescue Kit, Zcash
 * Status). A "title: value" fact is a tag at full label size, never a line of
 * small print; each item gets its own card with room around it.
 */

/**
 * Sizes, relative to the theme's label size (20px by default, so roughly
 * 12.5 / 13 / 15 / 13.5 px) so they still follow the text-size setting.
 */
export const FS = {
  tag: 'calc(var(--font-size-label) * 0.62)',
  body: 'calc(var(--font-size-label) * 0.65)',
  small: 'calc(var(--font-size-label) * 0.58)',
  title: 'calc(var(--font-size-label) * 0.75)',
  input: 'calc(var(--font-size-label) * 0.68)',
};

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'gold' | 'info';
const TONE: Record<Tone, string> = {
  ok: 'var(--accent-green)', warn: '#ffb347', bad: 'var(--accent-orange)',
  muted: 'var(--text-muted)', gold: 'var(--accent-gold)', info: 'var(--text-primary)',
};

export function Tag({ label, value, tone = 'info', title }: { label?: string; value: ReactNode; tone?: Tone; title?: string }) {
  const c = TONE[tone];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5"
      style={{
        fontSize: FS.tag, lineHeight: 1.3, padding: '2px 9px', borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${c} 45%, transparent)`,
        background: `color-mix(in srgb, ${c} 10%, transparent)`,
      }}
    >
      {label && <span style={{ color: 'var(--text-muted)' }}>{label}</span>}
      <span style={{ color: c, fontWeight: 600 }}>{value}</span>
    </span>
  );
}

/** Yes / no / unknown as a tag. `null` is "unknown", never "no". */
export function YesNo({ label, v, yes = 'yes', no = 'no' }: { label: string; v: boolean | null; yes?: string; no?: string }) {
  return <Tag label={label} value={v === true ? `✓ ${yes}` : v === false ? `✗ ${no}` : '? unknown'} tone={v === true ? 'ok' : v === false ? 'bad' : 'muted'} />;
}

export function Card({ children, accent }: { children: ReactNode; accent?: Tone }) {
  return (
    <div
      className="flex flex-col gap-2.5"
      style={{
        padding: '12px 14px', borderRadius: 10, background: 'var(--bg-inset)',
        border: `1px solid ${accent ? `color-mix(in srgb, ${TONE[accent]} 45%, transparent)` : 'var(--border-window)'}`,
      }}
    >
      {children}
    </div>
  );
}

export function Tags({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

export function CardTitle({ children, href, right }: { children: ReactNode; href?: string; right?: ReactNode }) {
  const t = <span className="text-[var(--accent-gold)] font-bold" style={{ fontSize: FS.title }}>{children}</span>;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">{t}</a> : t}
      {right && <div className="ml-auto flex items-center gap-2 flex-wrap">{right}</div>}
    </div>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <div className="text-[var(--text-secondary)] leading-relaxed" style={{ fontSize: FS.body }}>{children}</div>;
}

export function Sources({ list }: { list: { label: string; url: string }[] }) {
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[var(--text-muted)]" style={{ fontSize: FS.small }}>
      <span>Sources:</span>
      {list.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--accent-gold)]">{s.label}</a>)}
    </div>
  );
}

/** A labelled select for toolbars. */
export function Picker<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center gap-2" style={{ fontSize: FS.body }}>
      <span className="text-[var(--text-muted)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}
        className="bg-[var(--bg-inset)] border border-[var(--border-window)] px-2 py-1 text-[var(--text-primary)]" style={{ borderRadius: 6, fontSize: FS.body }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export const inputStyle = 'w-full bg-[var(--bg-inset)] border border-[var(--border-window)] text-[var(--text-primary)] px-3 py-1.5 focus:outline-none focus:border-[var(--accent-gold)]';
