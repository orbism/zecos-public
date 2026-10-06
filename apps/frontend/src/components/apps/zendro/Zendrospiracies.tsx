'use client';

import { useEffect, useMemo } from 'react';
import theories from '@/data/zendrospiracies.json';
import { fadeInResume, fadeOutPause } from '@/lib/zecamp/engine';
import { ZendroView } from './Zendro';
import type { ZendroBrand, ZendroEvent, ZendroOptions } from './engine';

/** Zendrospiracies: Zendro's engine, grown from the stranger rings. Every theory is sourced to where it was said. */
const BRAND: ZendroBrand = {
  id: 'zendrospiracies', name: 'Zendrospiracies', short: 'Zendrospiracies', kicker: 'The rings they did not want counted', subject: 'the Zcash conspiracy trunk', theme: 'crt',
  intro: (n, from, to) => `Every tree hides rings nobody meant to count. This one holds ${n} theories about Zcash, from ${from} to ${to}, each traced to where it was said online. Sourced, not endorsed. Make of them what you will.`,
};

const MUSIC_KEY = 'zendrospiracies:music', LEVEL = 0.6;
const remembered = () => { try { return localStorage.getItem(MUSIC_KEY) !== 'off'; } catch { return true; } };

/**
 * The theme tune. It takes over from zecAmp (fades it to a pause) once it is
 * actually playing, and hands zecAmp back, fading in, when switched off or when
 * the app closes, but only if zecAmp was playing to begin with.
 */
function useThemeTune(): NonNullable<ZendroOptions['music']> {
  const ctl = useMemo(() => {
    let on = remembered(), handed = false, raf = 0, retry: (() => void) | null = null;
    const a = new Audio('/pink_panther.mp3'); a.loop = true; a.volume = 0;
    const fadeTo = (to: number, ms: number, then?: () => void) => {
      cancelAnimationFrame(raf);
      const from = a.volume, t0 = performance.now();
      const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (to - from) * k; if (k < 1) raf = requestAnimationFrame(step); else then?.(); };
      step();
    };
    const unretry = () => { if (retry) document.removeEventListener('pointerdown', retry, true); retry = null; };
    const start = async () => {
      if (!on) return;
      try { await a.play(); } catch {
        // No autoplay yet: the first click anywhere starts it
        if (!retry) { retry = () => { unretry(); void start(); }; document.addEventListener('pointerdown', retry, true); }
        return;
      }
      fadeTo(LEVEL, 1500);
      if (!handed) handed = await fadeOutPause();
      if (!on) halt();   // switched off mid-fade
    };
    const halt = () => {
      unretry();
      fadeTo(0, 600, () => a.pause());
      if (handed) { handed = false; void fadeInResume(); }
    };
    const music = {
      get on() { return on; },
      toggle: () => {
        on = !on;
        try { localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
        if (on) void start(); else halt();
        return on;
      },
    };
    return { music, start, stop: () => { unretry(); cancelAnimationFrame(raf); a.pause(); a.volume = 0; if (handed) { handed = false; void fadeInResume(); } } };
  }, []);
  useEffect(() => { void ctl.start(); return ctl.stop; }, [ctl]);
  return ctl.music;
}

export default function Zendrospiracies() {
  const music = useThemeTune();
  return <ZendroView events={theories as ZendroEvent[]} brand={BRAND} music={music} />;
}
