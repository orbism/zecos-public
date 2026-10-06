'use client';

import { useCallback, useRef } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { whenAudioAllowed } from '@/utils/audioUnlock';

// 8-bit sound generation using Web Audio API
// No external files needed - generates sounds programmatically

type SoundType = 'click' | 'open' | 'close' | 'minimize' | 'error' | 'beep'
  | 'tap' | 'toggle' | 'confirm' | 'hover' | 'coin' | 'message';

interface SoundConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  volume: number;
  ramp?: 'up' | 'down';
}

const SOUND_CONFIGS: Record<SoundType, SoundConfig> = {
  click: { frequency: 800, duration: 0.05, type: 'square', volume: 0.1 },
  open: { frequency: 400, duration: 0.1, type: 'square', volume: 0.15, ramp: 'up' },
  close: { frequency: 300, duration: 0.08, type: 'square', volume: 0.1, ramp: 'down' },
  minimize: { frequency: 600, duration: 0.06, type: 'square', volume: 0.1, ramp: 'down' },
  error: { frequency: 200, duration: 0.2, type: 'sawtooth', volume: 0.15 },
  beep: { frequency: 1000, duration: 0.1, type: 'square', volume: 0.1 },
  // Newer, subtler set for general button/link clicks
  tap: { frequency: 660, duration: 0.03, type: 'square', volume: 0.06 },        // soft universal click
  toggle: { frequency: 520, duration: 0.05, type: 'triangle', volume: 0.08, ramp: 'up' },
  confirm: { frequency: 880, duration: 0.09, type: 'triangle', volume: 0.1, ramp: 'up' },
  hover: { frequency: 1200, duration: 0.02, type: 'sine', volume: 0.03 },       // whisper on hover
  coin: { frequency: 1046, duration: 0.12, type: 'square', volume: 0.09, ramp: 'up' },
  message: { frequency: 784, duration: 0.13, type: 'sine', volume: 0.12, ramp: 'up' }, // soft incoming-chat chime
};

// Perceptual volume curve. Linear amplitude sounds nearly constant across the
// top half of a slider (loudness is logarithmic), so map slider 0-1 to a
// -40dB…0dB gain range. Returns 0 at slider 0 → true mute.
// Master volume → linear gain. BOOST lifts the whole curve so max is louder than
// unity (Web Audio gain nodes accept >1). vol=1 → BOOST (~+5dB), vol→0 → mute.
// NOTE: callers that set HTMLAudioElement.volume MUST clamp to [0,1] - that API
// throws on values above 1, unlike Web Audio GainNodes.
const VOLUME_BOOST = 1.8;
export function masterGain(): number {
  const vol = useSettingsStore.getState().volume ?? 0.8;
  if (vol <= 0) return 0;
  return VOLUME_BOOST * Math.pow(10, 2 * (vol - 1));
}

/**
 * Keep a playing HTMLAudioElement at `scale` of the master volume, following
 * the taskbar slider and mute while it plays. Returns the unsubscribe; call it
 * when the element stops. Clamped: HTMLAudioElement.volume throws above 1.
 */
export function followVolume(el: HTMLAudioElement, scale: number): () => void {
  const apply = () => {
    const s = useSettingsStore.getState();
    el.volume = s.soundEnabled ? Math.min(1, scale * masterGain()) : 0;
  };
  apply();
  return useSettingsStore.subscribe(apply);
}

export function useSound() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const { soundEnabled } = useSettingsStore();

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    // A context created before any user interaction starts suspended, which is
    // the normal case on a standalone route loaded straight from a link.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => whenAudioAllowed(() => { ctx.resume().catch(() => {}); }));
    }
    return ctx;
  }, []);

  const playSound = useCallback((type: SoundType) => {
    if (!soundEnabled) return;
    const gain = masterGain();
    if (gain <= 0) return; // slider at 0 = hard mute

    try {
      const ctx = getAudioContext();
      // Not playable NOW means not at all: a suspended context keeps every
      // scheduled note and plays the whole backlog the moment it is unlocked -
      // a burst of stale clicks long after whatever made them.
      if (ctx.state !== 'running') return;
      const config = SOUND_CONFIGS[type];

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = config.type;
      oscillator.frequency.setValueAtTime(config.frequency, ctx.currentTime);

      // Apply frequency ramp for 8-bit effect
      if (config.ramp === 'up') {
        oscillator.frequency.setValueAtTime(config.frequency * 0.5, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(config.frequency, ctx.currentTime + config.duration);
      } else if (config.ramp === 'down') {
        oscillator.frequency.exponentialRampToValueAtTime(config.frequency * 0.5, ctx.currentTime + config.duration);
      }

      // Volume envelope - perceptually scaled master volume
      gainNode.gain.setValueAtTime(config.volume * gain, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + config.duration);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + config.duration);
    } catch (e) {
      // Silently fail if audio not available
    }
  }, [getAudioContext, soundEnabled]);

  return {
    playClick: useCallback(() => playSound('click'), [playSound]),
    playOpen: useCallback(() => playSound('open'), [playSound]),
    playClose: useCallback(() => playSound('close'), [playSound]),
    playMinimize: useCallback(() => playSound('minimize'), [playSound]),
    playError: useCallback(() => playSound('error'), [playSound]),
    playBeep: useCallback(() => playSound('beep'), [playSound]),
    playTap: useCallback(() => playSound('tap'), [playSound]),
    playToggle: useCallback(() => playSound('toggle'), [playSound]),
    playConfirm: useCallback(() => playSound('confirm'), [playSound]),
    playHover: useCallback(() => playSound('hover'), [playSound]),
    playCoin: useCallback(() => playSound('coin'), [playSound]),
  };
}

// Global sound context for use outside React components
let globalAudioContext: AudioContext | null = null;

export function playSoundGlobal(type: SoundType) {
  const gain = masterGain();
  if (gain <= 0 || !useSettingsStore.getState().soundEnabled) return;
  try {
    if (!globalAudioContext) {
      globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const ctx = globalAudioContext;
    // Same rule as the hook: never queue a note on a context that cannot play it yet.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return;
    const config = SOUND_CONFIGS[type];

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = config.type;
    oscillator.frequency.setValueAtTime(config.frequency, ctx.currentTime);

    if (config.ramp === 'up') {
      oscillator.frequency.setValueAtTime(config.frequency * 0.5, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(config.frequency, ctx.currentTime + config.duration);
    } else if (config.ramp === 'down') {
      oscillator.frequency.exponentialRampToValueAtTime(config.frequency * 0.5, ctx.currentTime + config.duration);
    }

    gainNode.gain.setValueAtTime(config.volume * gain, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + config.duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + config.duration);
  } catch (e) {
    // Silently fail
  }
}
