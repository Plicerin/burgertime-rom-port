// Renders the game's sound to a WAV file: the translated main and sound
// programs fed an input script (MAME input lag, as recorded), the AY writes
// through the board mixer and decimator (src/btimeMixer.mjs) to 48 kHz, as
// the audio worklet does.
//   node tools/render-audio.mjs <frames> <out.wav> [inputs.txt]
import { writeFileSync } from 'node:fs';
import { BtimeMachine, BtimeSound } from '../src/btimeMachine.mjs';
import { SOUND_CYCLES_PER_FRAME } from '../src/btimeSound.mjs';
import { BtimeMixer, Decimator, framesTicks } from '../src/btimeMixer.mjs';
import { applyInputs, readInputScript, MAME_INPUT_LAG } from './inputs.mjs';

const [framesText, out, inputPath] = process.argv.slice(2);
const frames = Number(framesText);
const inputs = inputPath ? readInputScript(inputPath) : new Map();
const RATE = 48000;
const main = new BtimeMachine();
const sound = new BtimeSound();
const mixer = new BtimeMixer();
const samples = [];
const decimator = new Decimator(RATE);
for (let f = 0; f < frames; f += 1) {
  main.runFrame();
  const start = sound.timeline.frame * SOUND_CYCLES_PER_FRAME;
  sound.runFrame(main.bus.soundCommands);
  const writes = framesTicks(sound.bus.writes, start);
  let w = 0;
  for (let t = 0; t < 3264; t += 1) {
    while (w < writes.length && writes[w][0] <= t) mixer.write(writes[w++]);
    const v = decimator.push(mixer.tick());
    if (v !== null) samples.push(v);
  }
  applyInputs(main, inputs.get(f - MAME_INPUT_LAG));
}
const pcm = Buffer.alloc(44 + samples.length * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + samples.length * 2, 4); pcm.write('WAVE', 8);
pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(samples.length * 2, 40);
samples.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
writeFileSync(out, pcm);
console.log(`${samples.length} samples (${(samples.length / RATE).toFixed(1)} s)`);
