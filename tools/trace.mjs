// Runs the oracle through attract mode and seeded random play sessions and
// records what the main CPU executes, for tools/recompile.mjs:
//  - every instruction, keyed by address and whether its opcode was
//    unscrambled (CPU-7), with an execution count
//  - every computed control transfer (RTS, RTI, JMP (ind), interrupts)
//  - every ROM byte read as data
//   node tools/trace.mjs [sessions] [frames]   -> tools/out/trace.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { OracleMachine } from './oracle.mjs';
import { applyInputs } from './inputs.mjs';
import { decode } from './disasm.mjs';
import { randomSession } from './sessions.mjs';

const sessions = Number(process.argv[2] ?? 8);
const frames = Number(process.argv[3] ?? 20000);

const executed = new Map(); // key -> count; key = addr | scrambled << 16
const decoded = new Map();  // key -> decode()
const dynamic = new Map();  // "from>key" -> count (from = instruction key, or 'irq'/'reset')
const dataReads = new Set();

function run(machine, inputs, n) {
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
    applyInputs(machine, inputs.get(f));
  }
}

run(new OracleMachine(), new Map(), 6000);
for (let s = 1; s <= sessions; s += 1) {
  run(new OracleMachine(), randomSession(frames, s), frames);
  process.stderr.write(`session ${s}: ${executed.size} instructions\n`);
}

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/trace.json', import.meta.url), JSON.stringify({
  executed: [...executed],
  dynamic: [...dynamic],
  dataReads: [...dataReads].sort((a, b) => a - b),
}));
console.log(`${executed.size} instruction keys, ${dynamic.size} computed transfers, ${dataReads.size} ROM data bytes`);
