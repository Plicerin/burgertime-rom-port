// Diffs the oracle against a MAME recording made by tools/mame/dump.lua:
// RAM, palette, video and colour RAM at every frame boundary.
//   node tools/compare-mame.mjs <dump.bin> [inputs.txt] [--reset N]
import { readFileSync } from 'node:fs';
import { OracleMachine } from './oracle.mjs';
import { applyInputs, readInputScript, MAME_INPUT_LAG } from './inputs.mjs';

const args = process.argv.slice(2);
const file = args[0];
const inputs = args[1] && !args[1].startsWith('--') ? readInputScript(args[1]) : new Map();
const resetAt = args.indexOf('--reset');
const resetCycles = resetAt >= 0 ? Number(args[resetAt + 1]) : 0;
const keepGoing = args.includes('--all'); // report every differing frame
const lagAt = args.indexOf('--lag');      // override MAME_INPUT_LAG
const lag = lagAt >= 0 ? Number(args[lagAt + 1]) : MAME_INPUT_LAG;

const REC = 4 + 4 + 2 + 5 + 0x800 + 0x10 + 0x800;
const dump = readFileSync(file);
const frames = dump.length / REC;
const m = new OracleMachine(undefined, { resetCycles });
const hex = (v, n = 2) => v.toString(16).padStart(n, '0');

let firstBad = -1;
let badFrames = 0;
for (let f = 0; f < frames; f += 1) {
  m.runFrame();
  const o = f * REC;
  const ram = dump.subarray(o + 15, o + 15 + 0x800);
  const pal = dump.subarray(o + 15 + 0x800, o + 15 + 0x810);
  const vid = dump.subarray(o + 15 + 0x810, o + 15 + 0x1010);
  const snap = m.snapshot();
  const diffs = [];
  const cmp = (name, a, b, base) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diffs.push(`${name} $${hex(base + i, 4)}: mame ${hex(a[i])} oracle ${hex(b[i])}`); };
  cmp('ram', ram, snap.ram, 0);
  cmp('pal', pal, snap.palette, 0xc00);
  cmp('vram', vid.subarray(0, 0x400), snap.vram, 0x1000);
  cmp('cram', vid.subarray(0x400), snap.cram, 0x1400);
  if (diffs.length) {
    const pc = dump.readUInt16LE(o + 8);
    console.log(`frame ${f}: ${diffs.length} differences (mame pc $${hex(pc, 4)}, oracle pc $${hex(m.cpu.pc, 4)})`);
    for (const d of diffs.slice(0, 12)) console.log('  ' + d);
    if (firstBad < 0) firstBad = f;
    badFrames += 1;
    if (!keepGoing) break;
  }
  applyInputs(m, inputs.get(f - lag));
}
if (firstBad < 0) console.log(`all ${frames} frames match MAME (RAM, palette, video, colour RAM)`);
else if (keepGoing) console.log(`${badFrames} of ${frames} frames differ`);
process.exitCode = firstBad < 0 ? 0 : 1;
