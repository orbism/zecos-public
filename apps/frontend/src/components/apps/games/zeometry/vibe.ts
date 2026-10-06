import { zecampAnalyser } from '@/lib/zecamp/engine';

/**
 * Listening to zecAmp. Whatever is playing there drives the arena: the grid's
 * colour, shockwaves on the kick, enemies throbbing with the bass, and in
 * Trip mode trails, a chromatic split and a colour wash. Visual only: nothing
 * here touches the simulation, so hitboxes, scores and online play are as
 * they were.
 */

export type VibeMode = 'off' | 'groove' | 'trip';
export const VIBE_MODES: VibeMode[] = ['off', 'groove', 'trip'];
export const VIBE_KEY = 'zeometry:vibe';

export interface Vibe {
  mode: VibeMode;
  /** Loudness, bass, mids, treble, each 0..1 and smoothed. */
  level: number; bass: number; mid: number; high: number;
  /** 1 on a kick, decaying to 0. */
  beat: number;
  /** True on the one frame a kick lands. */
  kick: boolean;
  /** Hue (degrees) that drifts with time and the mids. */
  hue: number;
  /** Nothing audible from zecAmp for a while. */
  silent: boolean;
  /** Eight log-spaced bands, 0..1, for the little spectrum on the music button. */
  bars: Float32Array;
}

export const QUIET: Vibe = { mode: 'off', level: 0, bass: 0, mid: 0, high: 0, beat: 0, kick: false, hue: 210, silent: true, bars: new Float32Array(8) };
const BAR_HZ = [40, 90, 200, 450, 1000, 2200, 5000, 11000, 18000];

export class Listener {
  private buf: Uint8Array<ArrayBuffer> | null = null;
  private avg = 0; private lastKick = 0; private quietFor = 0; private peak = 0.08;
  v: Vibe = { ...QUIET, bars: new Float32Array(8) };

  read(mode: VibeMode, dt: number, t: number): Vibe {
    const v = this.v;
    v.mode = mode; v.kick = false;
    const an = mode === 'off' ? null : zecampAnalyser();
    let level = 0, bass = 0, mid = 0, high = 0;
    if (an) {
      if (!this.buf || this.buf.length !== an.frequencyBinCount) this.buf = new Uint8Array(new ArrayBuffer(an.frequencyBinCount));
      an.getByteFrequencyData(this.buf);
      const hz = an.context.sampleRate / an.fftSize;
      const band = (lo: number, hi: number) => {
        const a = Math.max(1, Math.floor(lo / hz)), b = Math.min(this.buf!.length - 1, Math.ceil(hi / hz));
        let s = 0; for (let i = a; i <= b; i++) s += this.buf![i]!;
        return b >= a ? s / ((b - a + 1) * 255) : 0;
      };
      bass = band(30, 150); mid = band(300, 2000); high = band(4000, 12000); level = band(30, 12000);
      // Auto-gain: the tap sits after zecAmp's volume, so a quiet player would barely move
      // anything. Scale to the recent loudest moment instead (it decays over ~10 s).
      this.peak = Math.max(level, bass * 0.8, this.peak * Math.exp(-dt * 0.1), 0.04);
      const g = Math.min(4, 0.5 / this.peak);
      bass = Math.min(1, bass * g); mid = Math.min(1, mid * g); high = Math.min(1, high * g * 1.6); level = Math.min(1, level * g);
      for (let i = 0; i < 8; i++) { const b = Math.min(1, band(BAR_HZ[i]!, BAR_HZ[i + 1]!) * g * (1 + i * 0.25)); v.bars[i] = Math.max(b, v.bars[i]! - dt * 2.4); }
    } else v.bars.fill(0);
    const k = 1 - Math.exp(-dt * 14);
    v.level += (level - v.level) * k; v.bass += (bass - v.bass) * k; v.mid += (mid - v.mid) * k; v.high += (high - v.high) * k;
    // a kick: the bass jumping well above its own recent average
    this.avg += (bass - this.avg) * (1 - Math.exp(-dt * 2.5));
    if (bass > this.avg * 1.28 && bass > 0.22 && t - this.lastKick > 0.22) { this.lastKick = t; v.beat = 1; v.kick = true; }
    v.beat *= Math.exp(-dt * 5);
    this.quietFor = level < 0.015 ? this.quietFor + dt : 0;
    v.silent = this.quietFor > 1.2;
    v.hue = (v.hue + dt * (12 + v.mid * 140)) % 360;
    return v;
  }
}
