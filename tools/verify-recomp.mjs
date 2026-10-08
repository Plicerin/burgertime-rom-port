// Runs the translated main CPU program (src/btimeMachine.mjs) beside the
// oracle (the real ROMs, interpreted) and compares them at every frame:
// RAM, palette, video and colour RAM, video/background control, the sound
// commands written (value and cycle), CPU registers, cycle count and the next
// instruction (address and CPU-7 unscrambling).
//   node tools/verify-recomp.mjs [frames] [scenario,scenario,...]
// Scenarios (tools/scenarios.mjs): attract, play-<seed>, start<level>-<seed>,
// clear-<seed>, hiscore-<seed>, 2p-<seed>, lives-<seed>; a bare number n is play-n.
import { OracleMachine } from './oracle.mjs';
import { BtimeMachine } from '../src/btimeMachine.mjs';
import { applyInputs } from './inputs.mjs';
import { scenario, stepScenario } from './scenarios.mjs';

const frames = Number(process.argv[2] ?? 20000);
const names = (process.argv[3] ?? 'attract,1,2,3').split(',').map((n) => (/^\d+$/.test(n) ? (n === '0' ? 'attract' : `play-${n}`) : n));
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
for (const name of names) {
  // one scenario instance per machine: hooks keep state
  const sc = scenario(name, frames);
  const scR = scenario(name, frames);
  const o = new OracleMachine();
  const r = new BtimeMachine();
  let f = 0;
  try {
    for (; f < frames; f += 1) {
      o.runFrame();
      r.runFrame();
      const d = compare(o, r);
      if (d.length) {
        console.log(`${name}: frame ${f} differs`);
        for (const line of d.slice(0, 10)) console.log('  ' + line);
        failed = true;
        break;
      }
      stepScenario(o, sc, f, 0, applyInputs);
      stepScenario(r, scR, f, 0, applyInputs);
    }
  } catch (e) {
    console.log(`${name}: frame ${f}: ${e.message}`);
    failed = true;
  }
  if (!failed) console.log(`${name}: ${frames} frames identical (level ${o.bus.ram[0x61]}/${o.bus.ram[0x62]}, score ${[0x2f, 0x2e, 0x2d].map((a) => hex(o.bus.ram[a])).join('')})`);
  if (failed) break;
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exitCode = failed ? 1 : 0;
