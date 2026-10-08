// Renders oracle frames to PNG (rotated, as the monitor shows them).
//   node tools/snap.mjs <outdir> <frame,frame,...> [inputs.txt]
import { mkdirSync, writeFileSync } from 'node:fs';
import { OracleMachine } from './oracle.mjs';
import { applyInputs, readInputScript, MAME_INPUT_LAG } from './inputs.mjs';
import { decodeGfx, renderFrame, toScreenRGBA } from '../src/btimeVideo.mjs';
import { encodePNG } from './png.mjs';

const [outDir, list, inputPath] = process.argv.slice(2);
const want = new Set(list.split(',').map(Number));
const inputs = inputPath ? readInputScript(inputPath) : new Map();
const m = new OracleMachine();
const gfx = decodeGfx(m.roms.gfx1, m.roms.gfx2);
mkdirSync(outDir, { recursive: true });
const last = Math.max(...want);
for (let f = 0; f <= last; f += 1) {
  m.runFrame();
  if (want.has(f)) {
    const pens = renderFrame(m.bus, gfx, m.roms.bgMap);
    writeFileSync(`${outDir}/frame${String(f).padStart(5, '0')}.png`, encodePNG(240, 240, toScreenRGBA(pens, m.bus.palette), 2));
  }
  applyInputs(m, inputs.get(f - MAME_INPUT_LAG));
}
