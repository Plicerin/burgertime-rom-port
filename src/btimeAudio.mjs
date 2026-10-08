// Sends the sound CPU's AY writes to btimeSound.worklet.js, one emulated frame
// at a time. Browsers only allow audio after a user gesture, so call start()
// from an input event.
import { framesTicks } from './btimeMixer.mjs';

export function createAudio(workletUrl) {
  let ctx = null;
  let node = null;
  let silent = true;

  return {
    async start() {
      if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
      try {
        ctx = new AudioContext();
        await ctx.audioWorklet.addModule(workletUrl);
        node = new AudioWorkletNode(ctx, 'btime-sound', { outputChannelCount: [2] });
        node.connect(ctx.destination);
        node.port.postMessage({ silent });
      } catch (error) {
        console.warn('Sound unavailable:', error);
      }
    },
    // writes: SoundBus.writes for the frame that started at sound cycle `start`
    pushFrame(writes, start) {
      if (!node) return;
      node.port.postMessage({ writes: framesTicks(writes, start) });
    },
    setSilent(value) {
      if (silent === value) return;
      silent = value;
      node?.port.postMessage({ silent });
    },
    suspend() { ctx?.suspend(); },
    resume() { ctx?.resume(); },
  };
}
