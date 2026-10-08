// Compares oracle renders with MAME screenshots of the same frames.
//   node tools/compare-snaps.mjs <snapDir> <frame,frame,...> [inputs.txt]
// MAME names the snapshots 0000.png, 0001.png, ... in frame order.
import { readFileSync } from 'node:fs';
import { OracleMachine } from './oracle.mjs';
import { applyInputs, readInputScript, MAME_INPUT_LAG } from './inputs.mjs';
import { decodeGfx, renderFrame, toScreenRGBA } from '../src/btimeVideo.mjs';
import { decodePNG } from './png.mjs';

const [dir, list, inputPath] = process.argv.slice(2);
const frames = list.split(',').map(Number).sort((a, b) => a - b);
const inputs = inputPath ? readInputScript(inputPath) : new Map();
const m = new OracleMachine();
const gfx = decodeGfx(m.roms.gfx1, m.roms.gfx2);
let bad = 0;
for (let f = 0, k = 0; f <= frames.at(-1); f += 1) {
  m.runFrame();
  if (f === frames[k]) {
    const snap = decodePNG(readFileSync(`${dir}/${String(k).padStart(4, '0')}.png`));
    const s = m.snapshot();
    const mine = toScreenRGBA(renderFrame({ ...m.bus, ...s }, gfx, m.roms.bgMap), s.palette);
    let diff = 0;
    if (snap.width !== 240 || snap.height !== 240) { console.log(`frame ${f}: MAME snapshot is ${snap.width}x${snap.height}`); bad += 1; k += 1; continue; }
    for (let i = 0; i < mine.length; i += 4) if (mine[i] !== snap.rgba[i] || mine[i + 1] !== snap.rgba[i + 1] || mine[i + 2] !== snap.rgba[i + 2]) diff += 1;
    console.log(`frame ${f}: ${diff ? diff + ' pixels differ' : 'identical'}`);
    if (diff) bad += 1;
    k += 1;
  }
  applyInputs(m, inputs.get(f - MAME_INPUT_LAG));
}
process.exitCode = bad ? 1 : 0;
