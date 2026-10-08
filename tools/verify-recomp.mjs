// Runs the translated main CPU program (src/btimeMachine.mjs) beside the
// oracle (the real ROMs, interpreted) and compares them at every frame:
// RAM, palette, video and colour RAM, video/background control, the sound
// commands written (value and cycle), CPU registers, cycle count and the next
// instruction (address and CPU-7 unscrambling).
//   node tools/verify-recomp.mjs [frames] [seed,seed,...]   (seed 0 = attract)
import { OracleMachine } from './oracle.mjs';
import { BtimeMachine } from '../src/btimeMachine.mjs';
import { applyInputs } from './inputs.mjs';
import { randomSession } from './sessions.mjs';

const frames = Number(process.argv[2] ?? 20000);
const seeds = (process.argv[3] ?? '0,1,2,3').split(',').map(Number);
const hex = (v, n = 2) => v.toString(16).padStart(n, '0');

function compare(o, r) {
  const d = [];
  const arr = (name, a, b) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) { d.push(`${name}[${hex(i, 3)}] oracle ${hex(a[i])} recomp ${hex(b[i])}`); if (d.length > 8) return; } };
  arr('ram', o.bus.ram, r.bus.ram);
  arr('palette', o.bus.palette, r.bus.palette);
  arr('vram', o.bus.vram, r.bus.vram);
  arr('cram', o.bus.cram, r.bus.cram);
  for (const k of ['flip', 'bgControl']) if (o.bus[k] !== r.bus[k]) d.push(`${k} oracle ${o.bus[k]} recomp ${r.bus[k]}`);
  const sc = (b) => b.soundCommands.map(([t, v]) => `${t}:${hex(v)}`).join(' ');
  if (sc(o.bus) !== sc(r.bus)) d.push(`sound commands oracle [${sc(o.bus)}] recomp [${sc(r.bus)}]`);
  for (const k of ['a', 'x', 'y', 's', 'p', 'cycles', 'irqLine']) if (o.cpu[k] !== r.cpu[k]) d.push(`${k} oracle ${o.cpu[k]} recomp ${r.cpu[k]}`);
  if (o.cpu.pollI !== r.cpu.pollI) d.push(`pollI oracle ${o.cpu.pollI} recomp ${r.cpu.pollI}`);
  const okey = o.cpu.pc | (o.cpu.hadWritten && (o.cpu.pc & 0x104) === 0x104 ? 0x10000 : 0);
  if (okey !== r.cpu.key) d.push(`next instruction oracle ${hex(okey, 5)} recomp ${hex(r.cpu.key, 5)}`);
  return d;
}

let failed = false;
const t0 = Date.now();
for (const seed of seeds) {
  const inputs = seed === 0 ? new Map() : randomSession(frames, seed);
  const o = new OracleMachine();
  const r = new BtimeMachine();
  let f = 0;
  try {
    for (; f < frames; f += 1) {
      o.runFrame();
      r.runFrame();
      const d = compare(o, r);
      if (d.length) {
        console.log(`seed ${seed}: frame ${f} differs`);
        for (const line of d.slice(0, 10)) console.log('  ' + line);
        failed = true;
        break;
      }
      applyInputs(o, inputs.get(f));
      applyInputs(r, inputs.get(f));
    }
  } catch (e) {
    console.log(`seed ${seed}: frame ${f}: ${e.message}`);
    failed = true;
  }
  if (!failed) console.log(`seed ${seed}: ${frames} frames identical`);
  if (failed) break;
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exitCode = failed ? 1 : 0;
