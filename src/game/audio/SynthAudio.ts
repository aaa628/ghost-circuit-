/**
 * Procedural Web Audio sound engine — no audio files, nothing to 404.
 *
 *   engine    detuned saw + square through a resonant low-pass; pitch, cutoff
 *             and level follow speed / throttle / boost
 *   tick      countdown blips          checkpoint  two-note chime
 *   boost     filtered noise whoosh    thud        pitched-down sine + noise burst
 *   finish    arpeggio                 record      bigger fanfare
 *   dnf       falling tone             click       UI blip
 */
import { readString, writeString } from '../../services/storage';

const MUTE_KEY = 'gc:v1:muted';

type AudioCtor = typeof AudioContext;

export class SynthAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private noise: AudioBuffer | null = null;
  private engineOn = false;
  private lastThud = 0;
  private _muted: boolean;
  private disposed = false;

  constructor() {
    this._muted = readString(MUTE_KEY) === '1';
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    writeString(MUTE_KEY, muted ? '1' : '0');
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.02);
    }
  }

  /** Create/resume the AudioContext. Call from a user gesture. */
  unlock(): void {
    if (this.disposed) return;
    if (!this.ctx) {
      const Ctor: AudioCtor | undefined =
        globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.8;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.noise = this.makeNoise(ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1.0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return buf;
  }

  private ready(): AudioContext | null {
    if (!this.ctx || !this.sfxBus || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  // ── Engine ────────────────────────────────────────────────────────────────

  engineStart(): void {
    const ctx = this.ready();
    if (!ctx || this.engineOn || !this.master) return;
    this.engineOn = true;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 6;
    this.engineFilter.frequency.value = 500;
    this.engineOscA = ctx.createOscillator();
    this.engineOscA.type = 'sawtooth';
    this.engineOscB = ctx.createOscillator();
    this.engineOscB.type = 'square';
    this.engineOscB.detune.value = -1200 + 7;
    this.engineOscA.connect(this.engineFilter);
    this.engineOscB.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOscA.start();
    this.engineOscB.start();
  }

  /** speed01: 0..~1.4 (boost), throttle: 0..1 */
  engineUpdate(speed01: number, throttle: number, boosting: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineOn || !this.engineOscA || !this.engineOscB || !this.engineFilter || !this.engineGain) return;
    const t = ctx.currentTime;
    const f = 48 + speed01 * 150 + (boosting ? 38 : 0);
    this.engineOscA.frequency.setTargetAtTime(f, t, 0.05);
    this.engineOscB.frequency.setTargetAtTime(f * 1.01, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(380 + speed01 * 2000 + throttle * 500, t, 0.06);
    this.engineGain.gain.setTargetAtTime(0.035 + throttle * 0.035 + speed01 * 0.03, t, 0.08);
  }

  engineStop(): void {
    if (!this.engineOn) return;
    this.engineOn = false;
    const ctx = this.ctx;
    const a = this.engineOscA;
    const b = this.engineOscB;
    const g = this.engineGain;
    this.engineOscA = null;
    this.engineOscB = null;
    this.engineGain = null;
    this.engineFilter = null;
    if (ctx && g) g.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    const stopAt = ctx ? ctx.currentTime + 0.25 : 0;
    try {
      a?.stop(stopAt);
      b?.stop(stopAt);
    } catch {
      // already stopped
    }
  }

  // ── One-shots ─────────────────────────────────────────────────────────────

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const ctx = this.ready();
    if (!ctx || !this.sfxBus) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(this.sfxBus);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  private noiseBurst(start: number, dur: number, vol: number, from: number, to: number, type: BiquadFilterType): void {
    const ctx = this.ready();
    if (!ctx || !this.sfxBus || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, to), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  tick(go = false): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(go ? 880 : 440, t, go ? 0.35 : 0.14, 'square', 0.12);
    if (go) this.tone(1320, t, 0.35, 'triangle', 0.06);
  }

  checkpoint(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(988, t, 0.12, 'triangle', 0.16);
    this.tone(1480, t + 0.07, 0.2, 'triangle', 0.14);
  }

  boost(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.5, 0.35, 400, 5200, 'bandpass');
    this.tone(220, t, 0.4, 'sawtooth', 0.05, 660);
  }

  thud(intensity: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this.lastThud < 0.09) return;
    this.lastThud = t;
    const v = Math.min(1, Math.max(0.15, intensity));
    this.tone(150, t, 0.18, 'sine', 0.3 * v, 48);
    this.noiseBurst(t, 0.12, 0.18 * v, 1800, 300, 'lowpass');
  }

  zap(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(1200, t, 0.12, 'sawtooth', 0.07, 300);
  }

  finish(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, t + i * 0.08, 0.32, 'triangle', 0.14));
  }

  record(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
    notes.forEach((f, i) => {
      this.tone(f, t + i * 0.075, 0.42, 'square', 0.06);
      this.tone(f * 2, t + i * 0.075, 0.3, 'triangle', 0.05);
    });
    this.tone(1046.5, t + 0.5, 0.9, 'sawtooth', 0.05);
    this.noiseBurst(t + 0.45, 0.8, 0.12, 6000, 1200, 'highpass');
  }

  dnf(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(392, t, 0.25, 'square', 0.1, 330);
    this.tone(330, t + 0.22, 0.5, 'square', 0.1, 196);
  }

  click(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(1600, ctx.currentTime, 0.05, 'square', 0.04);
  }

  /** Pause/resume all sound (e.g. when the tab is hidden). */
  setSuspended(suspended: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (suspended && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
    else if (!suspended && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    this.engineStop();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }
}
