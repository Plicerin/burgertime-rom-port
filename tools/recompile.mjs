// Translates a Burger Time CPU program into JavaScript, instruction for
// instruction, with cycle counts (the Donkey Kong port's recompiler, extended
// for the CPU-7 and an interrupt-driven, time-sliced board):
//
//   node tools/recompile.mjs main   -> src/btimeMainRecomp.mjs + src/btimeMainData.mjs
//   node tools/recompile.mjs sound  -> src/btimeSoundRecomp.mjs + src/btimeSoundData.mjs
//
// Instructions come from the oracle's traces (tools/trace.mjs) plus a static
// walk from there (branch paths, call returns and fall-throughs the traces
// didn't reach). On the main CPU, a CPU-7, the same address can decode two
// ways, so every instruction is keyed by its address and whether its opcode is
// unscrambled (bit 16): unscrambled when the instruction before it wrote to
// memory (or it is an interrupt handler's first) and the address matches
// xxxx xxx1 xxxx x1xx. That is known statically for every transfer except
// RTS/RTI/JMP (ind), which never write, so they always land unscrambled.
//
// The data module holds the ROM bytes no executed instruction occupies, plus
// any code bytes the traces saw read as data.
import { readFileSync, writeFileSync } from 'node:fs';
import { decode } from './disasm.mjs';
import { loadRoms } from './oracle.mjs';

const CPUS = {
  main: {
    rom: () => loadRoms().main, romStart: 0xc000, scrambled: true, ramEnd: 0x800,
    trace: './out/trace.json', code: '../src/btimeMainRecomp.mjs', data: '../src/btimeMainData.mjs',
    name: 'MAIN', what: 'the Burger Time main CPU program (ROMs aa04.9b, aa06.13b, aa05.10b, aa07.15b)',
  },
  sound: {
    // the 4K ROM answers at $E000 and $F000; the program only uses $F000
    rom: () => loadRoms().sound, romStart: 0xf000, mirror: 0xe000, scrambled: false, ramEnd: 0x400,
    trace: './out/trace-sound.json', code: '../src/btimeSoundRecomp.mjs', data: '../src/btimeSoundData.mjs',
    name: 'SOUND', what: 'the Burger Time sound CPU program (ROM ab14.12h, at $E000 and mirrored at $F000)',
  },
};
const which = process.argv[2] ?? 'main';
const cfg = CPUS[which];
if (!cfg) throw new Error(`unknown CPU ${which}`);

const rom = cfg.rom();
const trace = JSON.parse(readFileSync(new URL(cfg.trace, import.meta.url)));
const hex = (v, n = 2) => v.toString(16).padStart(n, '0');
const $ = (v, n) => '0x' + hex(v, n);
const PATTERN = (a) => (a & 0x0104) === 0x0104;
const keyOf = (addr, wrote) => addr | (cfg.scrambled && wrote && PATTERN(addr) ? 0x10000 : 0);
const keyText = (k) => `$${hex(k & 0xffff, 4).toUpperCase()}${k >> 16 ? '*' : ''}`;
const vector = (a) => rom[a] | (rom[a + 1] << 8);

const WRITES = new Set(['sta', 'stx', 'sty', 'pha', 'php', 'jsr', 'brk']);
const writes = (ins) => WRITES.has(ins.mn) || (['inc', 'dec', 'asl', 'lsr', 'rol', 'ror'].includes(ins.mn) && ins.mode !== 'acc');

// --- discover instructions ---
const executed = new Map(trace.executed.map(([k, n]) => [Number(k), n]));
const nodes = new Map(); // key -> instruction
const dead = new Set();  // keys that decode to an illegal opcode or leave the ROM
const work = [...executed.keys(), keyOf(vector(0xfffc), false), keyOf(vector(0xfffe), true), keyOf(vector(0xfffa), true)];
for (const e of trace.dynamic) { const to = Number(e[0].split('>')[1]); work.push(to); }
// JMP (ind) table entries the traces may not reach (JMP doesn't write, so
// they land unscrambled). Read from the ROM, ranges from the indexing code:
const TABLES = {
  main: [
    // $D3C4: Y = $A9,X >> 4, JMP ($0005) from $D3E8,Y: 5 handlers (the
    // following words are code)
    [0xd3e8, 5],
    // $E1B3: X = ($0202,Y & $F0) >> 3, JMP ($0006) from $E1C9,X: 16 handlers
    [0xe1c9, 16],
    // $F45F: name entry, X = ($EE - $1E) * 2 for the six cells after the 30
    // letters, JMP ($00D8) from $F4EB,X
    [0xf4eb, 6],
  ],
  sound: [
    // $F083: NMI tick, X = $04 * 2 for $04 = 0-4, JMP ($001C) from $F09E,X
    [0xf09e, 5],
    // $F2AB: command $00-$05, X = command * 2, JMP ($0041) from $F2D5,X
    [0xf2d5, 6],
    // $F271: command $11-$1E, X = (command & $0F) * 2, JMP ($003F) from
    // $F2E1,X: entries 1-14
    [0xf2e3, 14],
  ],
};
for (const [table, count] of TABLES[which]) for (let i = 0; i < count; i += 1) work.push(keyOf(vector(table + 2 * i), false));
const successors = (key, ins) => {
  const addr = key & 0xffff;
  const next = (addr + ins.size) & 0xffff;
  switch (ins.mn) {
    case 'jmp': return ins.mode === 'abs' ? [keyOf(ins.operand, false)] : [];
    case 'jsr': return [keyOf(ins.operand, true), keyOf(next, false)];
    case 'rts': case 'rti': return [];
    case 'brk': return [keyOf(vector(0xfffe), true)];
    default:
      if (ins.mode === 'rel') return [keyOf((next + ((ins.operand ^ 0x80) - 0x80)) & 0xffff, false), keyOf(next, false)];
      return [keyOf(next, writes(ins))];
  }
};
while (work.length) {
  const key = work.pop();
  if (nodes.has(key) || dead.has(key)) continue;
  const addr = key & 0xffff;
  if (addr < cfg.romStart) { dead.add(key); continue; }
  const ins = decode(rom, addr, key >> 16 === 1);
  if (ins.mn === '???' || addr + ins.size > 0x10000) { dead.add(key); continue; }
  nodes.set(key, ins);
  for (const s of successors(key, ins)) work.push(s);
}
for (const k of executed.keys()) if (!nodes.has(k)) throw new Error(`executed ${keyText(k)} did not decode`);

// --- data: ROM bytes outside executed instructions, plus code read as data:
// what the traces saw read, every fixed address an instruction reads, and the
// 256 bytes an indexed read (abs,X / abs,Y) can reach from its base. The game
// does index into its own code: the coin handler's credit limit check
// (CMP $D064,Y at $D00A) uses whatever Y the interrupted code left.
const isCode = new Uint8Array(0x10000);
for (const [k] of executed) { const ins = nodes.get(k); for (let i = 0; i < ins.size; i += 1) isCode[(k & 0xffff) + i] = 1; }
for (const a of trace.dataReads) isCode[a] = 0;
const STORES = new Set(['sta', 'stx', 'sty']);
for (const ins of nodes.values()) {
  if (STORES.has(ins.mn) || ins.operand < cfg.romStart) continue;
  if (ins.mode === 'abs' && !['jmp', 'jsr'].includes(ins.mn)) isCode[ins.operand] = 0;
  if (ins.mode === 'absx' || ins.mode === 'absy') for (let i = 0; i < 256 && ins.operand + i < 0x10000; i += 1) isCode[ins.operand + i] = 0;
  if (ins.mode === 'ind') { isCode[ins.operand] = 0; isCode[(ins.operand & 0xff00) | ((ins.operand + 1) & 0xff)] = 0; }
}
const spans = [];
for (let i = cfg.romStart; i < 0x10000;) {
  if (isCode[i]) { i += 1; continue; }
  let j = i;
  while (j < 0x10000 && !isCode[j]) j += 1;
  spans.push([i, rom.subarray(i, j)]);
  i = j;
}

// --- emit ---
const ea = (ins, read) => {
  const o = ins.operand;
  switch (ins.mode) {
    case 'zp': return $(o);
    case 'abs': return $(o, 4);
    case 'zpx': return `(${$(o)} + c.x) & 0xff`;
    case 'zpy': return `(${$(o)} + c.y) & 0xff`;
    case 'absx': return read ? `c.indexed(${$(o, 4)}, c.x)` : `(${$(o, 4)} + c.x) & 0xffff`;
    case 'absy': return read ? `c.indexed(${$(o, 4)}, c.y)` : `(${$(o, 4)} + c.y) & 0xffff`;
    case 'indx': return `c.indirectX(${$(o)})`;
    case 'indy': return `c.indirectY(${$(o)}, ${read})`;
    default: throw new Error(ins.mode);
  }
};
// fixed addresses go straight to RAM or the ROM data; everything else through the bus
const isRam = (ins) => (ins.mode === 'zp') || (ins.mode === 'abs' && ins.operand < cfg.ramEnd);
const value = (ins) => {
  if (ins.mode === 'imm') return $(ins.operand);
  if (isRam(ins)) return `ram[${ea(ins)}]`;
  if (ins.mode === 'abs' && ins.operand >= cfg.romStart) return `rom[${$(ins.operand, 4)}]`;
  return `c.read(${ea(ins, true)})`;
};
const store = (ins, v) => (isRam(ins) ? `ram[${ea(ins)}] = ${v};` : `c.write(${ea(ins, false)}, ${v});`);
const FLAG = { bpl: '!(c.p & 0x80)', bmi: '(c.p & 0x80)', bvc: '!(c.p & 0x40)', bvs: '(c.p & 0x40)', bcc: '!(c.p & 0x01)', bcs: '(c.p & 0x01)', bne: '!(c.p & 0x02)', beq: '(c.p & 0x02)' };
const SIMPLE = {
  inx: 'c.x = c.setNZ((c.x + 1) & 0xff);', dex: 'c.x = c.setNZ((c.x - 1) & 0xff);', iny: 'c.y = c.setNZ((c.y + 1) & 0xff);', dey: 'c.y = c.setNZ((c.y - 1) & 0xff);',
  tax: 'c.x = c.setNZ(c.a);', txa: 'c.a = c.setNZ(c.x);', tay: 'c.y = c.setNZ(c.a);', tya: 'c.a = c.setNZ(c.y);', tsx: 'c.x = c.setNZ(c.s);', txs: 'c.s = c.x;',
  pha: 'c.push(c.a);', pla: 'c.a = c.setNZ(c.pull());', php: 'c.push(c.p | 0x30);',
  plp: 'c.pollI = c.p & 0x04; c.p = (c.pull() & ~0x10) | 0x20;',
  clc: 'c.p &= ~0x01;', sec: 'c.p |= 0x01;', cli: 'c.pollI = c.p & 0x04; c.p &= ~0x04;', sei: 'c.pollI = c.p & 0x04; c.p |= 0x04;',
  clv: 'c.p &= ~0x40;', cld: 'c.p &= ~0x08;', sed: 'c.p |= 0x08;', nop: '',
};
// after these the interrupt poll catches up with I one instruction later
const LAGS_I = new Set(['cli', 'sei', 'plp']);

// The instruction's effect; control transfers go through go(key) for a known
// target or goDyn(expression) for a computed one (see the blocks below).
const body = (key, ins, go, goDyn) => {
  const addr = key & 0xffff;
  const next = (addr + ins.size) & 0xffff;
  const { mn, mode } = ins;
  if (SIMPLE[mn] !== undefined) return SIMPLE[mn];
  switch (mn) {
    case 'lda': return `c.a = c.setNZ(${value(ins)});`;
    case 'ldx': return `c.x = c.setNZ(${value(ins)});`;
    case 'ldy': return `c.y = c.setNZ(${value(ins)});`;
    case 'sta': return store(ins, 'c.a');
    case 'stx': return store(ins, 'c.x');
    case 'sty': return store(ins, 'c.y');
    case 'adc': return `c.adc(${value(ins)});`;
    case 'sbc': return `c.sbc(${value(ins)});`;
    case 'and': return `c.a = c.setNZ(c.a & ${value(ins)});`;
    case 'ora': return `c.a = c.setNZ(c.a | ${value(ins)});`;
    case 'eor': return `c.a = c.setNZ(c.a ^ ${value(ins)});`;
    case 'cmp': return `c.cmp(c.a, ${value(ins)});`;
    case 'cpx': return `c.cmp(c.x, ${value(ins)});`;
    case 'cpy': return `c.cmp(c.y, ${value(ins)});`;
    case 'bit': return `c.bit(${value(ins)});`;
    case 'asl': case 'lsr': case 'rol': case 'ror':
      if (mode === 'acc') return `c.a = c.${mn}(c.a);`;
      return isRam(ins) ? `ram[${ea(ins)}] = c.${mn}(ram[${ea(ins)}]);` : `c.rmw(${ea(ins, false)}, (v) => c.${mn}(v));`;
    case 'inc': case 'dec': {
      const op = mn === 'inc' ? '+' : '-';
      return isRam(ins) ? `ram[${ea(ins)}] = c.setNZ((ram[${ea(ins)}] ${op} 1) & 0xff);` : `c.rmw(${ea(ins, false)}, (v) => c.setNZ((v ${op} 1) & 0xff));`;
    }
    case 'jmp':
      if (mode === 'abs') return go(keyOf(ins.operand, false));
      return goDyn(`c.read(${$(ins.operand, 4)}) | (c.read(${$((ins.operand & 0xff00) | ((ins.operand + 1) & 0xff), 4)}) << 8)`);
    case 'jsr': return `c.push(${$((next - 1) >> 8)}); c.push(${$((next - 1) & 0xff)}); ${go(keyOf(ins.operand, true))}`;
    case 'rts': return goDyn('(c.pull() | (c.pull() << 8)) + 1 & 0xffff');
    case 'rti': return 'c.p = (c.pull() & ~0x10) | 0x20; pc = c.pull() | (c.pull() << 8); c.pollI = c.p & 0x04; return c.cycles < end ? interrupts(c, pc) : pc;';
    case 'brk': return `c.pc = ${$((addr + 2) & 0xffff, 4)}; return brk(c);`;
    default:
      if (mode === 'rel') {
        const target = (next + ((ins.operand ^ 0x80) - 0x80)) & 0xffff;
        const cross = (target & 0xff00) !== (next & 0xff00);
        return `if (${FLAG[mn]}) { ${cross ? 'c.cycles += 2;' : 'c.cycles += 1; c.brAt = c.cycles;'} ${go(keyOf(target, false))} }`;
      }
      throw new Error(`unsupported ${mn} at ${keyText(key)}`);
  }
};

const keys = [...nodes.keys()].sort((a, b) => ((a & 0xffff) - (b & 0xffff)) || (a - b));
// Instructions executed right after CLI/SEI/PLP: the interrupt poll catches up
// with I after them. Interrupt lines only change between run() calls, so an
// interrupt can first be taken at run()'s start, after RTI, or where the poll
// opens: after the instruction following CLI or PLP (SEI only closes it).
const afterLag = new Map(); // key -> check for interrupts?
for (const k of keys) {
  const ins = nodes.get(k);
  if (!LAGS_I.has(ins.mn)) continue;
  const s = successors(k, ins)[0];
  afterLag.set(s, (afterLag.get(s) ?? false) || ins.mn !== 'sei');
}

// Instructions are emitted in blocks of consecutive keys, each block a small
// function with its own switch (one 5000-case switch is too big for V8 to
// optimise, and ran 60 times slower than the interpreter). Inside a block a
// known target is a jump to its case; anything else returns the next key to
// run(), which looks up its block. A block returns -1 at the end of the slice.
const BLOCK = 32;
const blockOf = new Map(keys.map((k, i) => [k, Math.floor(i / BLOCK)]));
const SET_POLL = 'c.pollI = c.p & 0x04;';

const out = [];
out.push(`// GENERATED by tools/recompile.mjs from ${cfg.what} -- do not edit.
// Each case is one instruction${cfg.scrambled ? `: its ROM address, plus 0x10000 when the CPU-7
// fetches its opcode unscrambled (marked *),` : ' at its ROM address,'} with the cycles it takes.
//
// run(c, bus, end): executes from instruction key c.key until c.cycles reaches
// end, stopping between instructions exactly where the oracle (tools/oracle.mjs)
// does, and taking interrupts where it would. Interrupt inputs (c.nmiPending,
// c.irqLine) may only change between calls.

const hex = (v) => v.toString(16);

// interrupt entry (6502: push PC and P, set I, 7 cycles); the handler is
// reached after a write, so on the CPU-7 its first opcode can be unscrambled
function enter(c, key, vectorKey) {
  c.cycles += 7;
  const pc = key & 0xffff;
  c.push(pc >> 8); c.push(pc & 0xff); c.push((c.p & ~0x10) | 0x20);
  c.p |= 0x04; c.pollI = 0x04;
  return vectorKey;
}
// take a pending NMI, else an unmasked IRQ (MAME HOLD_LINE: taking it clears
// the line when c.irqHold is set)
function interrupts(c, key) {
  if (c.deferInt) return key;
  if (c.nmiPending) { c.nmiPending = false; return enter(c, key, ${$(keyOf(vector(0xfffa), true), 5)}); }
  if (c.irqLine && !c.pollI) { if (c.irqHold) c.irqLine = false; return enter(c, key, ${$(keyOf(vector(0xfffe), true), 5)}); }
  return key;
}
function brk(c) {
  c.cycles += 7;
  c.push(c.pc >> 8); c.push(c.pc & 0xff); c.push(c.p | 0x30);
  c.p |= 0x04; c.pollI = 0x04;
  return ${$(keyOf(vector(0xfffe), true), 5)};
}
`);
const nBlocks = Math.ceil(keys.length / BLOCK);
for (let b = 0; b < nBlocks; b += 1) {
  const blockKeys = keys.slice(b * BLOCK, (b + 1) * BLOCK);
  out.push(`function b${b}(c, bus, ram, rom, end, pc) {
  for (;;) {
    switch (pc) {`);
  for (let i = 0; i < blockKeys.length; i += 1) {
    const key = blockKeys[i];
    const ins = nodes.get(key);
    const succ = successors(key, ins);
    const ends = ['jmp', 'rts', 'rti', 'brk', 'jsr'].includes(ins.mn);
    const fall = ins.mode === 'rel' ? succ[1] : succ[0];
    const lag = afterLag.has(key);
    const check = lag && afterLag.get(key);
    // after a CLI/SEI/PLP's successor the interrupt poll sees I again
    const go = (k) => {
      const jump = blockOf.get(k) === b ? `pc = ${$(k, 5)}; continue;` : `return ${$(k, 5)};`;
      if (!lag) return jump;
      return check ? `${SET_POLL} if (c.cycles < end) { pc = interrupts(c, ${$(k, 5)}); if (pc !== ${$(k, 5)}) return pc; } ${jump}` : `${SET_POLL} ${jump}`;
    };
    const goDyn = (expr) => {
      if (!lag) return `return ${expr};`;
      return check ? `pc = ${expr}; ${SET_POLL} return c.cycles < end ? interrupts(c, pc) : pc;` : `${SET_POLL} return ${expr};`;
    };
    const text = body(key, ins, go, goDyn);
    let after = '';
    if (!ends) {
      if (!nodes.has(fall)) after = `throw new Error('ran into data at ${keyText(fall)}');`;
      else if (lag || blockKeys[i + 1] !== fall) after = go(fall);
    }
    out.push(`      case ${$(key, 5)}: if (c.cycles >= end) { c.key = ${$(key, 5)}; return -1; } c.cycles += ${ins.cyc}; ${text}${after ? ' ' + after : ''} // ${keyText(key)} ${ins.text}`);
  }
  out.push(`      default: return pc;
    }
  }
}`);
}
out.push(`
const BLOCKS = [${Array.from({ length: nBlocks }, (_, b) => `b${b}`).join(', ')}];
const BLOCK_SIZE = ${BLOCK};
const KEYS = [${keys.map((k) => $(k, 5)).join(',')}];
// instruction key -> its block
const TABLE = new Array(0x20000);
KEYS.forEach((k, i) => { TABLE[k] = BLOCKS[Math.floor(i / BLOCK_SIZE)]; });

export function run(c, bus, end) {
  const ram = bus.ram;
  const rom = bus.rom;
  let pc = c.key;
  if (c.deferInt && c.cycles < end) {
    // an interrupt raised after the last instruction sampled: one more
    // instruction runs before it can be taken
    c.deferInt = false;
    const block = TABLE[pc];
    if (!block) throw new Error('no instruction at $' + hex(pc & 0xffff) + (pc >> 16 ? '*' : ''));
    const next = block(c, bus, ram, rom, c.cycles + 1, pc); // one instruction
    pc = next === -1 ? c.key : next;
  }
  if (c.cycles < end) pc = interrupts(c, pc);
  while (pc >= 0) {
    const block = TABLE[pc];
    if (!block) throw new Error('no instruction at $' + hex(pc & 0xffff) + (pc >> 16 ? '*' : ''));
    pc = block(c, bus, ram, rom, end, pc);
  }
}

export const RESET_KEY = ${$(keyOf(vector(0xfffc), false), 5)};
`);
writeFileSync(new URL(cfg.code, import.meta.url), out.join('\n'));

const data = [`// GENERATED by tools/recompile.mjs: the ROM's tables, text and other data
// for ${cfg.what.replace(/^the /, 'the ')}: every byte no executed instruction occupies, by address. The code is
// translated in ${cfg.code.split('/').pop()}.

export const ${cfg.name}_DATA = [`];
for (const [at, bytes] of spans) data.push(`  [${$(at, 4)}, '${Buffer.from(bytes).toString('hex')}'],`);
data.push(`];

// 64K image with the data in place; code addresses read as 0
export function ${which}DataImage() {
  const mem = new Uint8Array(0x10000);
  for (const [at, hexBytes] of ${cfg.name}_DATA) {
    for (let i = 0; i < hexBytes.length / 2; i += 1) mem[at + i] = parseInt(hexBytes.substr(i * 2, 2), 16);
  }${cfg.mirror ? `
  mem.copyWithin(${$(cfg.mirror, 4)}, ${$(cfg.romStart, 4)}, 0x10000); // the ROM's mirror` : ''}
  return mem;
}
`);
writeFileSync(new URL(cfg.data, import.meta.url), data.join('\n'));

// listing for reading the program: address (* = unscrambled), bytes, times
// executed in the traces (- = found statically), instruction
const lst = keys.map((k) => {
  const ins = nodes.get(k);
  const bytes = [...rom.subarray(k & 0xffff, (k & 0xffff) + ins.size)].map((v) => hex(v)).join(' ');
  return `${keyText(k).padEnd(6)} ${bytes.padEnd(9)} ${String(executed.get(k) ?? '-').padStart(9)}  ${ins.text}`;
});
writeFileSync(new URL(`./out/${which}.lst`, import.meta.url), lst.join('\n') + '\n');

const staticOnly = keys.filter((k) => !executed.has(k)).length;
const dataBytes = spans.reduce((n, [, b]) => n + b.length, 0);
console.log(`${which}: ${keys.length} instructions (${executed.size} executed in traces, ${staticOnly} found statically), ${dead.size} dead ends, ${dataBytes} data bytes in ${spans.length} spans`);
