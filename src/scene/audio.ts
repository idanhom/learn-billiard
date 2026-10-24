/**
 * Sound, made from the simulation's own events: the cue striking, the balls
 * meeting, a cushion, a pocket. Synthesised with the Web Audio API, so there
 * is nothing to load, and each sound is as loud as its contact was hard.
 *
 * A browser lets a page make sound only once the player has done something,
 * so the audio wakes on the first stroke.
 */

import { MAX_CUE_SPEED } from '../constants';
import type { SimEvent } from '../physics/world';

export type SoundKind = 'strike' | SimEvent['type'];

/** The speed at which each sound is as loud as it gets, in m/s. */
const FULL: Record<SoundKind, number> = {
  strike: MAX_CUE_SPEED,
  'ball-ball': 3,
  cushion: 2.5,
  pocket: 2,
};

/** Kept well short of clipping when several sounds land together. */
const MASTER_GAIN = 0.5;

/**
 * How loud a contact at `speed` sounds, from 0 to 1: rising more slowly than
 * the speed, so a soft touch stays audible, and capped at full.
 */
export function loudness(kind: SoundKind, speed: number): number {
  if (!(speed > 0)) return 0;
  return Math.min(1, Math.max(0.04, (speed / FULL[kind]) ** 0.7));
}

export class TableAudio {
  #context: AudioContext | undefined;
  #noise: AudioBuffer | undefined;
  #enabled: boolean;
  /** Sounds asked for since the page loaded, by kind, whether or not the browser has let them play. */
  readonly asked: Record<SoundKind, number> = { strike: 0, 'ball-ball': 0, cushion: 0, pocket: 0 };

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(value: boolean) {
    this.#enabled = value;
    if (value) this.#wake();
  }

  /** The cue has struck the cue ball. A stroke is a gesture the browser accepts, so it also wakes the audio. */
  strike(speed: number): void {
    this.#wake();
    this.#play('strike', loudness('strike', speed));
  }

  event(event: SimEvent): void {
    this.#play(event.type, loudness(event.type, event.speed));
  }

  #wake(): void {
    if (!this.#enabled) return;
    if (!this.#context) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.#context = new Context();
    }
    if (this.#context.state === 'suspended') void this.#context.resume();
  }

  #play(kind: SoundKind, gain: number): void {
    if (!this.#enabled || gain <= 0) return;
    this.asked[kind]++;
    const context = this.#context;
    if (!context || context.state !== 'running') return;
    const level = gain * MASTER_GAIN;
    switch (kind) {
      case 'strike':
        // Leather on phenolic: a short, woody tock.
        this.#click(context, 1800, 1.2, 0.035, level * 0.7);
        this.#tone(context, 900, 500, 0.03, level * 0.2);
        return;
      case 'ball-ball':
        // Two balls: the sharp, bright click.
        this.#click(context, 3500, 2, 0.04, level * 0.8);
        this.#tone(context, 2600, 2400, 0.05, level * 0.3);
        return;
      case 'cushion':
        // Rubber and wood: a dull thud.
        this.#click(context, 500, 0.8, 0.09, level * 0.6);
        this.#tone(context, 140, 90, 0.12, level * 0.5);
        return;
      case 'pocket':
        // The drop, and the rattle as it settles.
        this.#tone(context, 110, 55, 0.25, level * 0.8);
        this.#click(context, 900, 0.7, 0.18, level * 0.3, 0.04);
        return;
    }
  }

  /** Noise through a band-pass filter, dying away over `decay` seconds. */
  #click(context: AudioContext, frequency: number, q: number, decay: number, gain: number, delay = 0): void {
    const start = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = this.#noiseBuffer(context);
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const envelope = this.#envelope(context, start, decay, gain);
    source.connect(filter).connect(envelope).connect(context.destination);
    source.start(start);
    source.stop(start + decay + 0.02);
  }

  /** A sine sliding from `from` to `to` hertz, dying away over `decay` seconds. */
  #tone(context: AudioContext, from: number, to: number, decay: number, gain: number): void {
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + decay);
    const envelope = this.#envelope(context, start, decay, gain);
    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + decay + 0.02);
  }

  #envelope(context: AudioContext, start: number, decay: number, gain: number): GainNode {
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + decay);
    return envelope;
  }

  #noiseBuffer(context: AudioContext): AudioBuffer {
    if (!this.#noise) {
      this.#noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.3), context.sampleRate);
      const samples = this.#noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    return this.#noise;
  }
}
