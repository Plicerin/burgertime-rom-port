// Burger Time sound output worklet: plays the sound CPU's AY writes through
// the board's mixer and decimator (btimeMixer.mjs) at the output rate.
// Messages: { writes: [[tick, chip, isAddress, value], ...] } once per
// emulated frame (3264 AY steps; ticks within it), { silent: bool }.
import { BtimeMixer, Decimator, TICKS_PER_FRAME } from './btimeMixer.mjs';

const MAX_QUEUE = 4; // frames buffered before catching up

class BtimeSoundProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mixer = new BtimeMixer();
    this.queue = [];
    this.frame = null;
    this.tick = 0;
    this.next = 0;
    this.decimator = new Decimator(sampleRate);
    this.silent = true;
    this.port.onmessage = ({ data }) => {
      if (data.writes) {
        this.queue.push(data.writes);
        // running behind: apply the oldest frames' writes at once
        while (this.queue.length > MAX_QUEUE) for (const w of this.queue.shift()) this.mixer.write(w);
      }
      if (data.silent !== undefined) this.silent = data.silent;
    };
  }

  // one AY step: apply the frame's writes due by now, then step the chips.
  // With no frame queued the chips keep sounding their current registers.
  stepOnce() {
    if (!this.frame && this.queue.length) { this.frame = this.queue.shift(); this.tick = 0; this.next = 0; }
    const frame = this.frame;
    if (frame) {
      while (this.next < frame.length && frame[this.next][0] <= this.tick) this.mixer.write(frame[this.next++]);
      this.tick += 1;
      if (this.tick >= TICKS_PER_FRAME) { while (this.next < frame.length) this.mixer.write(frame[this.next++]); this.frame = null; }
    }
    return this.mixer.tick();
  }

  process(inputs, outputs) {
    const out = outputs[0];
    for (let i = 0; i < out[0].length; i += 1) {
      let s = null;
      while (s === null) s = this.decimator.push(this.stepOnce());
      const v = this.silent ? 0 : Math.max(-1, Math.min(1, s));
      for (let c = 0; c < out.length; c += 1) out[c][i] = v;
    }
    return true;
  }
}

registerProcessor('btime-sound', BtimeSoundProcessor);
