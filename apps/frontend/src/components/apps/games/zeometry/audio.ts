import { masterGain } from '@/hooks/useSound';
import { useSettingsStore } from '@/store/settingsStore';
import type { GameEvent } from './engine';

/**
 * Bleeps, synthesised: no files to load. Follows the taskbar's volume and
 * mute. Rate-limited per kind, because a hundred explosions in one frame
 * should sound like one big one, not a hundred.
 */
let ctx: AudioContext | null = null;
const last: Record<string, number> = {};

function out(): AudioContext | null {
  if (typeof window === 'undefined' || !useSettingsStore.getState().soundEnabled) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
function tone(kind: string, gap: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number) {
  const a = out(); if (!a) return;
  const now = a.currentTime;
  if ((last[kind] ?? -1) > now - gap) return;
  last[kind] = now;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
  g.gain.setValueAtTime(vol * masterGain() * 0.25, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g).connect(a.destination); o.start(now); o.stop(now + dur + 0.02);
}
function noise(kind: string, gap: number, dur: number, vol: number, cutoff: number) {
  const a = out(); if (!a) return;
  const now = a.currentTime;
  if ((last[kind] ?? -1) > now - gap) return;
  last[kind] = now;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = buf; f.type = 'lowpass'; f.frequency.value = cutoff; g.gain.value = vol * masterGain() * 0.35;
  s.connect(f).connect(g).connect(a.destination); s.start(now);
}

export function sound(evs: GameEvent[]) {
  for (const e of evs) {
    if (e.k === 'shot') tone('shot', 0.07, 1400, 500, 0.05, 'square', 0.12);
    else if (e.k === 'boom') noise(e.n > 40 ? 'bigboom' : 'boom', e.n > 40 ? 0.1 : 0.04, e.n > 40 ? 0.7 : 0.18, e.n > 40 ? 0.9 : 0.35, e.n > 40 ? 900 : 2200);
    else if (e.k === 'note') tone('note', 0.03, 1800, 2400, 0.06, 'sine', 0.15);
    else if (e.k === 'bomb') { noise('bomb', 0.2, 1.2, 1, 600); tone('bombt', 0.2, 120, 40, 1, 'sawtooth', 0.5); }
    else if (e.k === 'die') { noise('die', 0.2, 1.4, 1, 500); tone('diet', 0.2, 400, 30, 1.2, 'triangle', 0.6); }
    else if (e.k === 'wave') { tone('w1', 0, 523, 523, 0.12, 'square', 0.2); setTimeout(() => tone('w2', 0, 784, 784, 0.12, 'square', 0.2), 110); setTimeout(() => tone('w3', 0, 1046, 1046, 0.2, 'square', 0.2), 220); }
    else if (e.k === 'life') tone('life', 0.3, 660, 1320, 0.4, 'triangle', 0.4);
  }
}
