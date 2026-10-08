// Burger Time sound output: the two AY-3-8910s (ay8910.mjs) stepped at their
// real 187.5 kHz rate, with the sound board's mixing network as MAME models
// it (btime_sound_discrete):
//   - AY1 A, B, C and AY2 B, C summed and scaled by 0.2
//   - AY2 A (the 1k-loaded channel) through a multiple-feedback op-amp band
//     pass: R51 5k in, R50 10k to ground, R49 47k feedback, 0.068 uF caps
//     (centre ~187 Hz, gain ~4.7)
//   - an inverting op-amp mixer (10k / 100k), then two CR high passes: 10k with
//     10 uF, and the speaker (3 ohm) with 100 uF
//   - MAME's output gain (x7 from volts)
// Used by the audio worklet and by tools/render-audio.mjs.
import { AY8910 } from './ay8910.mjs';

export const AY_RATE = 187500;
export const TICKS_PER_FRAME = 3264; // AY steps per frame: 3 every 8 sound CPU cycles

// analog second-order section -> digital biquad (bilinear transform)
function biquad(b0, b1, b2, a0, a1, a2, fs) {
  const k = 2 * fs, k2 = k * k;
  const A0 = a0 + a1 * k + a2 * k2;
  return {
    b0: (b0 + b1 * k + b2 * k2) / A0, b1: (2 * b0 - 2 * b2 * k2) / A0, b2: (b0 - b1 * k + b2 * k2) / A0,
    a1: (2 * a0 - 2 * a2 * k2) / A0, a2: (a0 - a1 * k + a2 * k2) / A0,
    x1: 0, x2: 0, y1: 0, y2: 0,
  };
}
// CR high pass: y = a (y' + x - x')
const highPass = (rc, fs) => ({ a: rc / (rc + 1 / fs), x: 0, y: 0 });

export class BtimeMixer {
  constructor() {
    this.ay = [new AY8910([5000, 5000, 5000]), new AY8910([1000, 5000, 5000])];
    // MFB band pass: H(s) = -(s / (R1 C)) / (s^2 + s 2/(Rf C) + (R1 + R2)/(R1 R2 Rf C^2))
    const R1 = 5000, R2 = 10000, RF = 47000, C = 0.068e-6;
    this.bp = biquad(0, -1 / (R1 * C), 0, (R1 + R2) / (R1 * R2 * RF * C * C), 2 / (RF * C), 1, AY_RATE);
    this.hp1 = highPass(10000 * 10e-6, AY_RATE);
    this.hp2 = highPass(3 * 100e-6, AY_RATE);
  }

  // [tick, chip, isAddress, value]
  write(w) { if (w[2]) this.ay[w[1]].address(w[3]); else this.ay[w[1]].data(w[3]); }

  // one AY step; returns the output sample (about -1..1)
  tick() {
    const a = this.ay[0], b = this.ay[1];
    a.tick(); b.tick();
    // channel levels are fractions of the 5 V supply
    const direct = 0.2 * 5 * (a.out[0] + a.out[1] + a.out[2] + b.out[1] + b.out[2]);
    const f = this.bp;
    const x = 5 * b.out[0];
    let y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
    y = Math.max(-5, Math.min(5, y)); // op-amp rails
    let v = -0.1 * (direct + y);
    const h1 = this.hp1; h1.y = h1.a * (h1.y + v - h1.x); h1.x = v; v = h1.y;
    const h2 = this.hp2; h2.y = h2.a * (h2.y + v - h2.x); h2.x = v; v = h2.y;
    return v * 7;
  }
}

// AY writes of one frame (SoundBus.writes, sound CPU cycles) as ticks within it
export function framesTicks(writes, frameStartCycle) {
  return writes.map(([cycle, chip, isAddress, value]) => [
    Math.min(TICKS_PER_FRAME - 1, Math.max(0, Math.floor(((cycle - frameStartCycle) * 3) / 8))), chip, isAddress, value]);
}

// Resamples the 187.5 kHz mixer output to the output rate: a 4th-order
// Butterworth low pass (two biquads, cutoff 0.45 x the output rate) and then
// the average of the steps in each output sample.
export class Decimator {
  constructor(outRate) {
    this.step = AY_RATE / outRate;
    this.pos = 0;
    this.sum = 0;
    this.n = 0;
    const fc = 0.45 * outRate;
    // Butterworth poles: Q = 0.5412 and 1.3066; low pass section s-domain:
    // w^2 / (s^2 + s w/Q + w^2) (bilinear with prewarping)
    const w = 2 * AY_RATE * Math.tan((Math.PI * fc) / AY_RATE);
    this.lp = [0.5412, 1.3066].map((q) => biquad(w * w, 0, 0, w * w, w / q, 1, AY_RATE));
  }

  // feed one mixer step; returns an output sample when one is complete
  push(v) {
    for (const f of this.lp) {
      const y = f.b0 * v + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
      f.x2 = f.x1; f.x1 = v; f.y2 = f.y1; f.y1 = y;
      v = y;
    }
    this.sum += v; this.n += 1;
    this.pos += 1;
    if (this.pos < this.step) return null;
    this.pos -= this.step;
    const out = this.sum / this.n;
    this.sum = 0; this.n = 0;
    return out;
  }
}
