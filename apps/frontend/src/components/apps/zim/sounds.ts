import { masterGain } from '@/hooks/useSound';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * ZIM's sounds, synthesised: a creaky door opening when a buddy signs on, a
 * door thudding shut when one signs off, a pop in and a bloop out, and the
 * voice - plain at sign-in, gloriously cheesy when a message lands. Our
 * own take on the idea - no recordings.
 *
 * All of them honour the sound setting and play only if they can play NOW:
 * nothing is queued on a locked audio context to burst out later.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!useSettingsStore.getState().soundEnabled || masterGain() <= 0) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx.state === 'running' ? ctx : null;
  } catch { return null; }
}

/** A short burst of filtered noise: the body of a creak or a thud. */
function noise(c: AudioContext, at: number, dur: number, freq: number, q: number, vol: number) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol * masterGain(), at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(at); src.stop(at + dur);
}

/** A buddy signed on: a hinge creaking open, rising. */
export function doorOpen() {
  const c = audio(); if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(180, t);
  o.frequency.linearRampToValueAtTime(420, t + 0.35);
  o.frequency.linearRampToValueAtTime(300, t + 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05 * masterGain(), t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 6;
  o.connect(f).connect(g).connect(c.destination);
  o.start(t); o.stop(t + 0.56);
  noise(c, t, 0.4, 1400, 3, 0.05);
}

/** A buddy signed off: the door swinging shut and a low thud. */
export function doorClose() {
  const c = audio(); if (!c) return;
  const t = c.currentTime;
  noise(c, t, 0.18, 700, 2, 0.06);
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t + 0.16);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.42);
  g.gain.setValueAtTime(0.0001, t + 0.16);
  g.gain.exponentialRampToValueAtTime(0.35 * masterGain(), t + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g).connect(c.destination);
  o.start(t + 0.16); o.stop(t + 0.46);
  noise(c, t + 0.16, 0.12, 180, 1, 0.2);
}

/** Two different pops: a bright one in, a rounder one out. Throttled so one message never pops twice. */
let lastPop = 0;
function pop(from: number, to: number, dur: number, vol: number, type: OscillatorType) {
  const c = audio(); if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * masterGain(), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

/** A message arrived: a quick bright "pop", rising. */
export function popIn() {
  const now = performance.now();
  if (now - lastPop < 1200) return; // the tray and an open chat can both notice the same message
  lastPop = now;
  pop(620, 1480, 0.09, 0.22, 'sine');
}

/** A message went out: a rounder "bloop", falling. */
export function popOut() {
  pop(520, 190, 0.14, 0.28, 'triangle');
}

const CHEESE = [
  "Ooh la la! You've got a message, hot stuff!",
  'Ding dong! Somebody wants to talk to YOU!',
  "Incoming message! Somebody's thinking about you, sugar!",
  "Stop the presses! You've got mail, you absolute legend!",
  'Hey good lookin\'! A new message just slid into your Z I M!',
];

/** The cheesy one, for a message that just arrived. */
export function sayCheesy() {
  speakNow(CHEESE[Math.floor(Math.random() * CHEESE.length)]!, 1.15, 1.25);
}

/**
 * "You have messages", out loud. Browsers only let a page speak after the
 * person has clicked or typed something: if they have not yet (a session
 * restored on reload), it waits for their first click or key instead of
 * being dropped or queued.
 */
export function sayYouHaveMessages() {
  speakNow('You have messages.', 0.95, 1);
}

function speakNow(text: string, rate: number, pitch: number) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (!useSettingsStore.getState().soundEnabled || masterGain() <= 0) return;
  const speak = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.volume = Math.min(1, masterGain() * 1.5);
    u.rate = rate;
    u.pitch = pitch;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };
  const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
  if (active) { speak(); return; }
  const once = () => { window.removeEventListener('pointerdown', once, true); window.removeEventListener('keydown', once, true); speak(); };
  window.addEventListener('pointerdown', once, true);
  window.addEventListener('keydown', once, true);
}
