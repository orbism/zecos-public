'use client';

import { useWindowStore } from '@/store/windowStore';
import { useZecamp, play, pause, stop, next, prev, ZECAMP_APP } from '@/lib/zecamp/engine';
import { fmt, trackLabel } from './Zecamp';

/**
 * zecAmp minimised: a transport strip in the bottom bar, beside the BLOCKS
 * ticker (above it on a phone). Shown only while the window is minimised;
 * the logo brings the window back. Closing the window, not this, ends playback.
 */
export function useZecampDocked(): boolean {
  return useWindowStore((s) => s.windows.some((w) => w.type === ZECAMP_APP && w.minimized && !w.parked));
}

export default function ZecampStrip({ full }: { full?: boolean }) {
  const s = useZecamp();
  const t = s.tracks[s.index];
  const restore = () => useWindowStore.getState().focusWindow(ZECAMP_APP);
  const b = 'shrink-0 px-1.5 h-full text-[var(--text-muted)] hover:text-[var(--accent-gold)]';
  return (
    <div className={`flex items-center h-full min-w-0 border-[rgba(255,255,255,0.08)] ${full ? 'w-full border-b' : 'shrink-0 border-l'}`}
      style={{ fontSize: 'var(--font-size-trinket)', maxWidth: full ? undefined : 440 }}>
      <button onClick={restore} className="shrink-0 flex items-center gap-1.5 px-2 h-full" title="Open zecAmp">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/zecamp/logo.svg" alt="" width={14} height={14} />
      </button>
      <button className={b} onClick={() => void prev()} title="Previous" aria-label="Previous">⏮</button>
      <button className={b} onClick={() => (s.playing || s.paused ? pause() : void play())} title={s.playing ? 'Pause' : 'Play'} aria-label={s.playing ? 'Pause' : 'Play'}>{s.playing ? '⏸' : '▶'}</button>
      <button className={b} onClick={stop} title="Stop" aria-label="Stop">⏹</button>
      <button className={b} onClick={() => void next()} title="Next" aria-label="Next">⏭</button>
      <button onClick={restore} className="min-w-0 flex-1 truncate text-left px-2 text-[var(--text-secondary)]" title={s.station?.name ?? (t ? trackLabel(t) : 'zecAmp')}>
        {s.station ? `${s.station.name} (live)` : t ? trackLabel(t) : 'zecAmp'}
      </button>
      {s.buffering
        ? <span className="shrink-0 px-2 font-mono text-[var(--accent-gold)] animate-pulse" role="status">tuning…</span>
        : <span className="shrink-0 px-2 font-mono text-[var(--accent-gold)] tabular-nums">{fmt(s.time)}</span>}
    </div>
  );
}
