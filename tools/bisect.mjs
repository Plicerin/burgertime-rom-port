// Finds the first instruction where the translated main CPU and the oracle
// part ways: runs a scenario to a frame, then advances both a cycle at a time.
//   node tools/bisect.mjs <scenario> <frame>
import { OracleMachine } from './oracle.mjs';
import { BtimeMachine } from '../src/btimeMachine.mjs';
import { run } from '../src/btimeMainRecomp.mjs';
import { applyInputs } from './inputs.mjs';
import { scenario, stepScenario } from './scenarios.mjs';
import { decode } from './disasm.mjs';

const [name, frameText] = process.argv.slice(2);
const until = Number(frameText);
const sc = scenario(name, until + 10);
const scR = scenario(name, until + 10);
const o = new OracleMachine();
const r = new BtimeMachine();
for (let f = 0; f < until; f += 1) {
  o.runFrame(); r.runFrame();
  stepScenario(o, sc, f, 0, applyInputs);
  stepScenario(r, scR, f, 0, applyInputs);
}
const hex = (v, n = 2) => v.toString(16).padStart(n, '0');
const state = (m) => `a=${hex(m.cpu.a)} x=${hex(m.cpu.x)} y=${hex(m.cpu.y)} s=${hex(m.cpu.s)} p=${hex(m.cpu.p)} cyc=${m.cpu.cycles} irq=${m.cpu.irqLine} pollI=${m.cpu.pollI}`;
const okey = () => o.cpu.pc | (o.cpu.hadWritten && (o.cpu.pc & 0x104) === 0x104 ? 0x10000 : 0);
const history = [];
const end = o.cpu.cycles + 8 * 26112;
let frame = until;
while (o.cpu.cycles < end) {
  // frame boundary: scenario pokes and inputs, as runFrame callers apply them
  if (o.cpu.cycles >= (frame + 1) * 26112) {
    o.frame = r.frame = frame + 1;
    stepScenario(o, sc, frame, 0, applyInputs);
    stepScenario(r, scR, frame, 0, applyInputs);
    history.push(`  -- end of frame ${frame}`);
    frame += 1;
  }
  // one oracle step (an interrupt entry or an instruction), then the
  // translation up to the same cycle
  if (o.cpu.serviceInterrupts()) { o.cpu.irqLine = false; history.push(`  oracle IRQ -> ${hex(o.cpu.pc, 4)}`); }
  else {
    history.push(`  ${hex(o.cpu.pc, 4)} ${decode(o.roms.main, o.cpu.pc, o.cpu.hadWritten && (o.cpu.pc & 0x104) === 0x104).text}`);
    o.cpu.step();
  }
  run(r.cpu, r.bus, o.cpu.cycles);
  const same = o.cpu.cycles === r.cpu.cycles && okey() === r.cpu.key && o.cpu.a === r.cpu.a && o.cpu.x === r.cpu.x && o.cpu.y === r.cpu.y && o.cpu.p === r.cpu.p && o.cpu.s === r.cpu.s;
  if (!same) {
    console.log(history.slice(-14).join('\n'));
    console.log(`oracle  next ${hex(okey(), 5)} ${state(o)}`);
    console.log(`recomp  next ${hex(r.cpu.key, 5)} ${state(r)}`);
    process.exit(1);
  }
  if (history.length > 200) history.splice(0, 100);
}
console.log('no difference');
