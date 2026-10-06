import { masterGain } from '@/hooks/useSound';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Zkyline's soundtrack and sound effects, synthesised live: no files.
 *
 * A dark chiptune techno loop at 132 BPM in A phrygian: four-on-the-floor
 * kick, offbeat open hats, a rolling pulse-wave bassline, claps, and a cold
 * pulse arpeggio through a feedback delay. It runs on a 32-bar cycle (build,
 * drop, breakdown with a snare roll, drop again), scheduled a little ahead on
 * the audio clock so it never drifts. Menus and death muffle it behind a
 * low-pass filter; the run opens it up, and speed opens the lead further.
 *
 * Follows the taskbar's mute and volume, plus Zkyline's own music toggle.
 */

const BPM = 132;
const STEP = 60 / BPM / 4;          // one sixteenth
const AHEAD = 0.12;                  // seconds scheduled in advance
const MUTE_KEY = 'zkyline:music';

// A1, F1, G1, E1: i, VI, VII, v. Chord tones for the arp, as semitones over the root.
const ROOTS = [33, 29, 31, 28];
const CHORDS = [[0, 3, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12], [0, 3, 7, 10]];
const ARP = [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2];
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

type Mode = 'menu' | 'run' | 'dead' | 'paused';

class Music {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private filter!: BiquadFilterNode;
  private bus!: GainNode;
  private sfxBus!: GainNode;
  private delay!: DelayNode;
  private noise!: AudioBuffer;
  private pulse25!: PeriodicWave;
  private pulse12!: PeriodicWave;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private step = 0;
  private mode: Mode = 'menu';
  private intensity = 0;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === 'off'; } catch { /* private window */ }
  }

  /** Call from a click or key press: browsers only start audio after a gesture. */
  start() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) this.build();
    if (this.ctx!.state === 'suspended') void this.ctx!.resume();
    if (!this.timer) {
      this.next = this.ctx!.currentTime + 0.05;
      this.timer = setInterval(() => this.tick(), 25);
    }
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close();
    this.ctx = null;
  }
  setMode(m: Mode) {
    if (m === this.mode || !this.ctx) { this.mode = m; return; }
    this.mode = m;
    const t = this.ctx.currentTime, f = m === 'run' ? 17000 : m === 'paused' ? 380 : 750;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setTargetAtTime(f, t, m === 'run' ? 0.25 : 0.4);
    if (m === 'run' && this.step % 16 !== 0) this.step = Math.ceil(this.step / 16) * 16; // drop in on a downbeat
  }
  /** 0 to 1, from the run's speed: opens the lead's filter. */
  setIntensity(v: number) { this.intensity = Math.max(0, Math.min(1, v)); }
  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, this.muted ? 'off' : 'on'); } catch { /* private window */ }
    return this.muted;
  }

  private build() {
    const a = new AudioContext();
    this.ctx = a;
    const comp = a.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.15;
    this.master = a.createGain(); this.master.gain.value = 0;
    this.filter = a.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 750; this.filter.Q.value = 6;
    this.bus = a.createGain();
    this.bus.connect(this.filter).connect(this.master);
    this.sfxBus = a.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.master.connect(comp).connect(a.destination);
    // the lead's echo: dotted eighth, fed back, darkened
    this.delay = a.createDelay(1); this.delay.delayTime.value = STEP * 3;
    const fb = a.createGain(); fb.gain.value = 0.38;
    const dl = a.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.bus);
    this.noise = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.pulse25 = this.pulseWave(0.25);
    this.pulse12 = this.pulseWave(0.125);
  }
  private pulseWave(duty: number) {
    const n = 48, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return this.ctx!.createPeriodicWave(re, im);
  }

  private tick() {
    const a = this.ctx; if (!a) return;
    const on = useSettingsStore.getState().soundEnabled;
    const vol = on ? masterGain() * 0.5 : 0;
    this.master.gain.setTargetAtTime(this.mode === 'paused' ? vol * 0.5 : vol, a.currentTime, 0.08);
    this.bus.gain.setTargetAtTime(this.muted ? 0 : 1, a.currentTime, 0.1);
    while (this.next < a.currentTime + AHEAD) {
      this.play(this.step, this.next);
      this.next += STEP;
      this.step++;
    }
  }

  // ── the arrangement ──
  private play(step: number, t: number) {
    const bar = Math.floor(step / 16) % 32, s = step % 16, chord = Math.floor(step / 16) % 4;
    const root = ROOTS[chord]!, tones = CHORDS[chord]!;
    const intro = bar < 4, build = bar < 8, breakdown = bar >= 16 && bar < 20;
    const roll = bar === 19;
    // kick
    if (!breakdown && s % 4 === 0) this.kick(t);
    // hats
    if (!intro || s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.07 : 0.025, s % 4 === 2 ? 0.09 : 0.03);
    // claps
    if (!build && !breakdown && (s === 4 || s === 12)) this.clap(t);
    if (roll) this.snare(t, 0.05 + (s / 16) * 0.25);
    // bass: rolling offbeat sixteenths, octave pops
    if (!intro) {
      if (breakdown) { if (s === 0) this.bass(t, root, STEP * 14, 0.5, 300); }
      else if (s % 4 !== 0) this.bass(t, root + (s % 8 === 6 ? 12 : 0), STEP * 0.8, 0.55, 500 + this.intensity * 700);
    }
    // arp
    if (bar >= 8) {
      const open = breakdown ? 600 + (bar - 16 + s / 16) * 900 : 1400 + this.intensity * 4500;
      this.lead(t, root + 36 + tones[ARP[s]!]!, STEP * 0.7, breakdown ? 0.07 : 0.09, open);
    }
    // stabs in the second drop
    if (bar >= 24 && (s === 3 || s === 11)) for (const k of [0, 2]) this.lead(t, root + 24 + tones[k]!, STEP * 1.2, 0.05, 1800);
  }

  // ── voices ──
  private env(g: GainNode, t: number, peak: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  private kick(t: number) {
    const a = this.ctx!, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.95, 0.3);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.32);
    // a click on top so it cuts through
    const c = a.createOscillator(), cg = a.createGain();
    c.type = 'square'; c.frequency.setValueAtTime(900, t); c.frequency.exponentialRampToValueAtTime(120, t + 0.015);
    this.env(cg, t, 0.18, 0.02);
    c.connect(cg).connect(this.bus); c.start(t); c.stop(t + 0.03);
  }
  private noiseHit(t: number, type: BiquadFilterType, f: number, q: number, peak: number, dur: number, out: AudioNode = this.bus) {
    const a = this.ctx!, s = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain();
    s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    this.env(g, t, peak, dur);
    s.connect(fl).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  private hat(t: number, peak: number, dur: number) { this.noiseHit(t, 'highpass', 7500, 0.7, peak, dur); }
  private clap(t: number) { for (const o of [0, 0.011, 0.022]) this.noiseHit(t + o, 'bandpass', 1500, 1.2, 0.22, 0.09); }
  private snare(t: number, peak: number) { this.noiseHit(t, 'bandpass', 2200, 0.9, peak, 0.08); }
  private bass(t: number, m: number, dur: number, peak: number, cutoff: number) {
    const a = this.ctx!, o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.setPeriodicWave(this.pulse25); o.frequency.value = hz(m);
    f.type = 'lowpass'; f.Q.value = 9;
    f.frequency.setValueAtTime(cutoff * 2.4, t); f.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + dur);
    this.env(g, t, peak, dur);
    o.connect(f).connect(g).connect(this.bus); o.start(t); o.stop(t + dur + 0.02);
  }
  private lead(t: number, m: number, dur: number, peak: number, cutoff: number) {
    const a = this.ctx!, o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.setPeriodicWave(this.pulse12); o.frequency.value = hz(m);
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 4;
    this.env(g, t, peak, dur);
    o.connect(f).connect(g); g.connect(this.bus); g.connect(this.delay);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ── sound effects ──
  sfx(kind: string) {
    const a = this.ctx; if (!a || !useSettingsStore.getState().soundEnabled) return;
    const t = a.currentTime;
    const blip = (f0: number, f1: number, dur: number, peak: number, wave: PeriodicWave | OscillatorType) => {
      const o = a.createOscillator(), g = a.createGain();
      if (wave instanceof PeriodicWave) o.setPeriodicWave(wave); else o.type = wave;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      this.env(g, t, peak, dur);
      o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.02);
    };
    if (kind === 'jump') blip(330, 660, 0.09, 0.12, this.pulse25);
    if (kind === 'double') { blip(520, 1200, 0.12, 0.12, this.pulse12); blip(260, 600, 0.12, 0.06, 'triangle'); }
    if (kind === 'bounce') blip(180, 900, 0.2, 0.16, 'triangle');
    if (kind === 'land') this.noiseHit(t, 'lowpass', 900, 0.5, 0.12, 0.06, this.sfxBus);
    if (kind === 'prop') this.noiseHit(t, 'bandpass', 3200, 2, 0.08, 0.05, this.sfxBus);
    if (kind === 'glass') { this.noiseHit(t, 'highpass', 5000, 1, 0.35, 0.35, this.sfxBus); blip(2400, 1800, 0.18, 0.06, 'triangle'); blip(3100, 2600, 0.22, 0.04, 'triangle'); }
    if (kind === 'power') { blip(440, 880, 0.08, 0.12, this.pulse25); setTimeout(() => this.sfx('power2'), 70); }
    if (kind === 'power2') blip(660, 1320, 0.12, 0.12, this.pulse25);
    if (kind === 'shield') { this.noiseHit(t, 'bandpass', 1200, 1, 0.3, 0.25, this.sfxBus); blip(900, 200, 0.3, 0.12, 'square'); }
    if (kind === 'crack') this.noiseHit(t, 'lowpass', 600, 2, 0.25, 0.2, this.sfxBus);
    if (kind === 'die') { this.noiseHit(t, 'lowpass', 1400, 0.7, 0.5, 0.6, this.sfxBus); blip(420, 40, 0.7, 0.3, 'sawtooth'); }
  }
}

export const music = new Music();
