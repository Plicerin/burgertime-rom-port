// Runs the translated sound CPU program (BtimeSound) beside the oracle's
// interpreted sound CPU, both fed the same main CPU commands, and compares
// them at every frame: sound RAM, the AY writes (cycle, chip, port, value),
// latch and NMI enable, registers, cycle count and next instruction.
//   node tools/verify-sound.mjs [frames] [scenario,...]
import { OracleSound } from './oracle.mjs';
import { BtimeMachine, BtimeSound } from '../src/btimeMachine.mjs';
import { applyInputs } from './inputs.mjs';
import { scenario, stepScenario } from './scenarios.mjs';

const frames = Number(process.argv[2] ?? 20000);
const names = (process.argv[3] ?? 'attract,play-1,clear-2,hiscore-3,2p-4').split(',');
const hex = (v, n = 2) => v.toString(16).padStart(n, '0');

function compare(o, r) {
  const d = [];
  for (let i = 0; i < 0x400; i += 1) if (o.bus.ram[i] !== r.bus.ram[i]) { d.push(`ram[${hex(i, 3)}] oracle ${hex(o.bus.ram[i])} recomp ${hex(r.bus.ram[i])}`); if (d.length > 6) break; }
  const w = (b) => b.writes.map(([t, c, a, v]) => `${t}:${c}${a ? 'a' : 'd'}${hex(v)}`).join(' ');
  if (w(o.bus) !== w(r.bus)) d.push(`AY writes oracle [${w(o.bus).slice(0, 160)}] recomp [${w(r.bus).slice(0, 160)}]`);
  for (const k of ['latch', 'nmiEnable']) if (o.bus[k] !== r.bus[k]) d.push(`${k} oracle ${o.bus[k]} recomp ${r.bus[k]}`);
  for (const k of ['a', 'x', 'y', 's', 'p', 'cycles', 'irqLine', 'nmiPending', 'pollI', 'deferInt']) if (o.cpu[k] !== r.cpu[k]) d.push(`${k} oracle ${o.cpu[k]} recomp ${r.cpu[k]}`);
  if (o.cpu.pc !== r.cpu.key) d.push(`next instruction oracle ${hex(o.cpu.pc, 4)} recomp ${hex(r.cpu.key, 4)}`);
  return d;
}

let failed = false;
const t0 = Date.now();
for (const name of names) {
  const sc = scenario(name, frames);
  const main = new BtimeMachine();
  const o = new OracleSound();
  const r = new BtimeSound();
  let f = 0;
  try {
    for (; f < frames; f += 1) {
      main.runFrame();
      o.runFrame(main.bus.soundCommands);
      r.runFrame(main.bus.soundCommands);
      const d = compare(o, r);
      if (d.length) {
        console.log(`${name}: frame ${f} differs`);
        for (const line of d) console.log('  ' + line);
        failed = true;
        break;
      }
      stepScenario(main, sc, f, 0, applyInputs);
    }
  } catch (e) {
    console.log(`${name}: frame ${f}: ${e.stack}`);
    failed = true;
  }
  if (failed) break;
  console.log(`${name}: ${frames} frames identical`);
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exitCode = failed ? 1 : 0;
