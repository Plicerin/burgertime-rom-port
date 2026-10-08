// Runs the oracle through test scenarios (tools/scenarios.mjs: attract, random
// play, later levels, stage clears, high scores, two players, endless lives)
// and records what the main CPU executes, for tools/recompile.mjs:
//  - every instruction, keyed by address and whether its opcode was
//    unscrambled (CPU-7), with an execution count
//  - every computed control transfer (RTS, RTI, JMP (ind), interrupts)
//  - every ROM byte read as data
//   node tools/trace.mjs [frames] [scenario,...]   -> tools/out/trace.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { OracleMachine } from './oracle.mjs';
import { applyInputs } from './inputs.mjs';
import { decode } from './disasm.mjs';
import { scenario, stepScenario } from './scenarios.mjs';

const frames = Number(process.argv[2] ?? 20000);
export const TRACE_SCENARIOS = ['attract', ...[1, 2, 3, 4, 5, 6, 7, 8].map((s) => `play-${s}`),
  ...[2, 3, 4, 5, 6, 7, 8].map((n) => `start${n}-${n}`), 'clear-1', 'clear-2', 'clear-3', 'clear-4',
  'hiscore-1', 'hiscore-2', '2p-1', '2p-2', 'lives-1', 'lives-2'];
const names = process.argv[3] ? process.argv[3].split(',') : TRACE_SCENARIOS;

const executed = new Map(); // key -> count; key = addr | scrambled << 16
const decoded = new Map();  // key -> decode()
const dynamic = new Map();  // "from>key" -> count (from = instruction key, or 'irq'/'reset')
const dataReads = new Set();

function run(machine, sc, n) {
  const { cpu, bus } = machine;
  const mem = machine.roms.main;
  let cur = null; // instruction being executed: [addr, size]
  const read = bus.read.bind(bus);
  bus.read = (addr, cycles) => {
    if (addr >= 0xc000 && cur && (addr < cur[0] || addr >= cur[0] + cur[1])) dataReads.add(addr);
    return read(addr, cycles);
  };
  let lastKey = 'reset';
  let lastDynamic = true;
  machine.onInstruction = (c, pc) => {
    const scrambled = c.hadWritten && (pc & 0x104) === 0x104 ? 1 : 0;
    const key = pc | (scrambled << 16);
    executed.set(key, (executed.get(key) ?? 0) + 1);
    if (lastDynamic) { const e = `${lastKey}>${key}`; dynamic.set(e, (dynamic.get(e) ?? 0) + 1); }
    let d = decoded.get(key);
    if (!d) {
      d = decode(mem, pc, scrambled === 1);
      if (d.mn === '???') throw new Error(`illegal opcode at $${pc.toString(16)} (scrambled ${scrambled})`);
      d.dynamic = d.mn === 'rts' || d.mn === 'rti' || (d.mn === 'jmp' && d.mode === 'ind') || d.mn === 'brk';
      decoded.set(key, d);
    }
    cur = [pc, d.size];
    lastKey = key;
    lastDynamic = d.dynamic;
  };
  const service = cpu.serviceInterrupts.bind(cpu);
  cpu.serviceInterrupts = () => {
    const taken = service();
    if (taken) { lastKey = 'irq'; lastDynamic = true; cur = null; }
    return taken;
  };
  for (let f = 0; f < n; f += 1) {
    machine.runFrame();
    stepScenario(machine, sc, f, 0, applyInputs);
  }
}

for (const name of names) {
  run(new OracleMachine(), scenario(name, frames), frames);
  process.stderr.write(`${name}: ${executed.size} instructions\n`);
}

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/trace.json', import.meta.url), JSON.stringify({
  executed: [...executed],
  dynamic: [...dynamic],
  dataReads: [...dataReads].sort((a, b) => a - b),
}));
console.log(`${executed.size} instruction keys, ${dynamic.size} computed transfers, ${dataReads.size} ROM data bytes`);
