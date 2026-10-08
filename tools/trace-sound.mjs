// Records what the sound CPU executes while the oracle plays the test
// scenarios (the main CPU's commands drive it), for tools/recompile.mjs sound.
//   node tools/trace-sound.mjs [frames] [scenario,...]  -> tools/out/trace-sound.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { OracleMachine, OracleSound } from './oracle.mjs';
import { applyInputs } from './inputs.mjs';
import { decode } from './disasm.mjs';
import { scenario, stepScenario } from './scenarios.mjs';

const frames = Number(process.argv[2] ?? 20000);
const names = process.argv[3] ? process.argv[3].split(',')
  : ['attract', 'play-1', 'play-2', 'play-3', 'start2-2', 'start4-4', 'start6-6', 'clear-1', 'clear-2', 'hiscore-1', '2p-1', 'lives-1'];

const executed = new Map();
const decoded = new Map();
const dynamic = new Map();
const dataReads = new Set();

for (const name of names) {
  const sc = scenario(name, frames);
  const m = new OracleMachine();
  const s = new OracleSound(m.roms);
  const mem = m.roms.sound;
  let cur = null;
  const read = s.bus.read.bind(s.bus);
  s.bus.read = (addr, cycles) => {
    if (addr >= 0xe000 && cur && (addr < cur[0] || addr >= cur[0] + cur[1])) dataReads.add(addr);
    return read(addr, cycles);
  };
  let lastKey = 'reset';
  let lastDynamic = true;
  s.onInstruction = (c, pc) => {
    executed.set(pc, (executed.get(pc) ?? 0) + 1);
    if (lastDynamic) { const e = `${lastKey}>${pc}`; dynamic.set(e, (dynamic.get(e) ?? 0) + 1); }
    let d = decoded.get(pc);
    if (!d) {
      d = decode(mem, pc);
      if (d.mn === '???') throw new Error(`illegal opcode at $${pc.toString(16)}`);
      d.dynamic = d.mn === 'rts' || d.mn === 'rti' || (d.mn === 'jmp' && d.mode === 'ind') || d.mn === 'brk';
      decoded.set(pc, d);
    }
    cur = [pc, d.size];
    lastKey = pc;
    lastDynamic = d.dynamic;
  };
  const service = s.cpu.serviceInterrupts.bind(s.cpu);
  s.cpu.serviceInterrupts = () => {
    const nmi = s.cpu.nmiPending;
    const taken = service();
    if (taken) { lastKey = nmi ? 'nmi' : 'irq'; lastDynamic = true; cur = null; }
    return taken;
  };
  for (let f = 0; f < frames; f += 1) {
    m.runFrame();
    s.runFrame(m.bus.soundCommands);
    stepScenario(m, sc, f, 0, applyInputs);
  }
  process.stderr.write(`${name}: ${executed.size} instructions\n`);
}

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/trace-sound.json', import.meta.url), JSON.stringify({
  executed: [...executed],
  dynamic: [...dynamic],
  dataReads: [...dataReads].sort((a, b) => a - b),
}));
console.log(`${executed.size} instructions, ${dynamic.size} computed transfers, ${dataReads.size} ROM data bytes`);
