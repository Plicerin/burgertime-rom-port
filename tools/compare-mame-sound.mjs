// Diffs the oracle's sound CPU against a MAME recording (BTIME_SOUND, see
// tools/mame/dump.lua): sound RAM at every frame boundary and the AY writes
// made during each frame, in order.
//   node tools/compare-mame-sound.mjs <sound.bin> [inputs.txt] [--all]
import { readFileSync } from 'node:fs';
import { OracleMachine, OracleSound } from './oracle.mjs';
import { applyInputs, readInputScript, MAME_INPUT_LAG } from './inputs.mjs';

const args = process.argv.slice(2);
const buf = readFileSync(args[0]);
const inputs = args[1] && !args[1].startsWith('--') ? readInputScript(args[1]) : new Map();
const keepGoing = args.includes('--all');
const hex = (v, n = 2) => v.toString(16).padStart(n, '0');

// parse: frames[f] = { ram, regs, writes: [[port, value]] }
const frames = [];
const writes = new Map();
for (let o = 0; o < buf.length;) {
  const tag = buf.toString('latin1', o, o + 4);
  if (tag === 'AYWR') {
    const f = buf.readUInt32LE(o + 4);
    if (!writes.has(f)) writes.set(f, []);
    writes.get(f).push([buf[o + 8], buf[o + 9]]);
    o += 10;
  } else if (tag === 'SFRM') {
    const f = buf.readUInt32LE(o + 4);
    frames[f] = { pc: buf.readUInt16LE(o + 8), sp: buf[o + 13], ram: buf.subarray(o + 15, o + 15 + 0x400) };
    o += 15 + 0x400;
  } else throw new Error(`bad record at ${o}`);
}

const m = new OracleMachine();
const s = new OracleSound(m.roms);
const PORT = { '0false': 1, '0true': 2, '1false': 3, '1true': 4 };
let bad = 0;
let ramBad = 0;
let ayBad = 0;
let carried = []; // AY writes timed after the previous frame's boundary
const streamMine = [];
for (let f = 0; f < frames.length; f += 1) {
  m.runFrame();
  s.runFrame(m.bus.soundCommands);
  for (const [, chip, isAddr, v] of s.bus.writes) streamMine.push(`${PORT[`${chip}${isAddr}`]}:${hex(v)}`);
  // MAME's CPU stops mid-instruction at the boundary: a write timed at or
  // after it belongs to the next frame there
  const end = (f + 1) * 8704;
  const all = carried.concat(s.bus.writes);
  carried = all.filter(([t]) => t >= end);
  const mine = all.filter(([t]) => t < end).map(([, chip, isAddr, v]) => `${PORT[`${chip}${isAddr}`]}:${hex(v)}`).join(' ');
  const theirs = (writes.get(f) ?? []).map(([p, v]) => `${p}:${hex(v)}`).join(' ');
  const ramDiff = [];
  const ram = s.snapshotRam();
  // the stack page below the stack pointer is dead space (old pushes)
  const sp = Math.min(frames[f].sp, s.cpu.s);
  for (let i = 0; i < 0x400; i += 1) {
    if (i >= 0x100 && i <= 0x100 + sp) continue;
    if (frames[f].ram[i] !== ram[i]) ramDiff.push(`$${hex(i, 3)} mame ${hex(frames[f].ram[i])} oracle ${hex(ram[i])}`);
  }
  if (frames[f].sp !== s.cpu.s) ramDiff.push(`sp mame ${hex(frames[f].sp)} oracle ${hex(s.cpu.s)}`);
  if (mine !== theirs || ramDiff.length) {
    if (bad < 6) {
      console.log(`frame ${f}: mame pc $${hex(frames[f].pc, 4)} oracle pc $${hex(s.cpu.pc, 4)}`);
      if (mine !== theirs) { console.log(`  AY writes mame   [${theirs.slice(0, 200)}]`); console.log(`  AY writes oracle [${mine.slice(0, 200)}]`); }
      for (const d of ramDiff.slice(0, 6)) console.log('  ram ' + d);
    }
    bad += 1;
    if (ramDiff.length) ramBad += 1;
    if (mine !== theirs) ayBad += 1;
    if (!keepGoing) break;
  }
  applyInputs(m, inputs.get(f - MAME_INPUT_LAG));
}
// the whole AY write stream, position by position
const streamMame = [];
for (let f = 0; f < frames.length; f += 1) for (const [p, v] of writes.get(f) ?? []) streamMame.push(`${p}:${hex(v)}`);
let streamDiff = 0;
for (let i = 0; i < Math.max(streamMame.length, streamMine.length); i += 1) if (streamMame[i] !== streamMine[i]) streamDiff += 1;
console.log(`AY write stream: ${streamMame.length} writes in MAME, ${streamMine.length} in the oracle, ${streamDiff} positions differ`);
console.log(bad ? `${bad} of ${frames.length} frames differ (${ramBad} in RAM, ${ayBad} in AY writes)` : `all ${frames.length} frames match MAME (sound RAM and AY writes)`);
process.exitCode = bad ? 1 : 0;
