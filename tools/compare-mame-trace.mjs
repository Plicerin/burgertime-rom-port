// Diffs the oracle's sound CPU instruction stream against a MAME debugger
// trace of :audiocpu (attract mode, no inputs), including where interrupts
// are taken. MAME logs the opcode fetched just before an interrupt replaces
// it ("F04A: ..." then "(interrupted at F04A, IRQ n)"); that line is dropped.
//   node tools/compare-mame-trace.mjs <snd.tr>
import { readFileSync } from 'node:fs';
import { OracleMachine, OracleSound } from './oracle.mjs';

const lines = readFileSync(process.argv[2], 'latin1').split(/\r?\n/);
const mame = [];
for (const l of lines) {
  let m = /^([0-9A-F]{4}): /.exec(l);
  if (m) { mame.push(parseInt(m[1], 16)); continue; }
  m = /interrupted at ([0-9A-F]{4}), IRQ (\d+)/.exec(l);
  if (m) {
    const at = parseInt(m[1], 16);
    if (mame.at(-1) === at) mame.pop();
    mame.push(`${m[2] === '0' ? 'IRQ' : 'NMI'}@${at.toString(16)}`);
  }
}
const mo = new OracleMachine();
const s = new OracleSound(mo.roms);
const mine = [];
s.onInstruction = (c, pc) => mine.push(pc);
const service = s.cpu.serviceInterrupts.bind(s.cpu);
s.cpu.serviceInterrupts = () => {
  const pc = s.cpu.pc, nmi = s.cpu.nmiPending;
  const taken = service();
  if (taken) mine.push(`${nmi ? 'NMI' : 'IRQ'}@${pc.toString(16)}`);
  return taken;
};
const frameOf = [];
for (let f = 0; mine.length < mame.length + 10 && f < 2000; f += 1) {
  mo.runFrame();
  s.runFrame(mo.bus.soundCommands);
  frameOf.push(mine.length);
}
let i = 0;
while (i < mame.length && mame[i] === mine[i]) i += 1;
const fmt = (a) => a.slice(Math.max(0, i - 10), i + 4).map((v) => (typeof v === 'number' ? v.toString(16) : v)).join(' ');
if (i === mame.length) console.log(`all ${mame.length} traced instructions and interrupts match MAME`);
else {
  console.log(`first ${i} of ${mame.length} match (frame ${frameOf.findIndex((n) => n > i)})`);
  console.log(` mame: ${fmt(mame)}`);
  console.log(` mine: ${fmt(mine)}`);
}
