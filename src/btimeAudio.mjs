// Sends the sound CPU's AY writes to btimeSound.worklet.js, one emulated frame
// at a time. Browsers only allow audio after a user gesture, so call start()
// from an input event.
//
// Once sound is running it sets the game's pace: queued() is how many sent
// frames haven't finished playing, and the player runs frames to keep that
// near a small target. Pacing by the display instead drifts against the
// sound card's clock, and the queue running dry or over is an audible skip.
import { framesTicks } from './btimeMixer.mjs';

export function createAudio(workletUrl) {
  let ctx = null;
  let node = null;
  let silent = true;
  let sent = 0;
  let consumed = 0;

  return {
    async start() {
      if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
      try {
        ctx = new AudioContext();
        await ctx.audioWorklet.addModule(workletUrl);
        node = new AudioWorkletNode(ctx, 'btime-sound', { outputChannelCount: [2] });
        node.port.onmessage = ({ data }) => { if (data.consumed !== undefined) consumed = data.consumed; };
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
      sent += 1;
    },
    // true when the audio clock is running and can pace the game
    running: () => !!node && ctx.state === 'running',
    queued: () => sent - consumed,
    setSilent(value) {
      if (silent === value) return;
      silent = value;
      node?.port.postMessage({ silent });
    },
    suspend() { ctx?.suspend(); },
    resume() { ctx?.resume(); },
  };
}
