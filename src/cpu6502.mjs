// Minimal NMOS 6502 core (official opcodes, decimal mode included), from the
// Donkey Kong port. The dev oracle interprets the Burger Time ROMs with step();
// the translated code (btimeRecomp.mjs) uses the same registers, flags and
// arithmetic.
//
// Burger Time's main CPU is Data East's CPU-7: a 6502 whose opcode fetch is
// bit-swapped (see unscramble()) when the previous
// bus write has not yet been followed by an opcode fetch and the opcode's
// address matches xxxx xxx1 xxxx x1xx. `decrypt` turns that on.
//
// Timing: an instruction's cycles are added before it executes, so a bus
// access made by the instruction sees cycles = end of the instruction; reads
// and writes happen on its last cycle for every mode this game's I/O uses.
//
// bus: { read(addr, cycles) -> byte, write(addr, value, cycles) }

// cycles from power-on to the first opcode fetch. The 6502's reset sequence
// is 7 bus cycles; 8 lines both CPUs up with MAME (the sound CPU's AY writes
// then match MAME's write for write, tools/compare-mame-sound.mjs)
export const RESET_CYCLES = 8;

const C = 0x01, Z = 0x02, I = 0x04, D = 0x08, B = 0x10, U = 0x20, V = 0x40, N = 0x80;

export class M6502 {
  constructor(bus) {
    this.bus = bus;
    this.a = 0; this.x = 0; this.y = 0; this.s = 0xfd; this.p = U | I;
    this.pc = 0;
    this.cycles = 0;
    this.decrypt = false;     // CPU-7 opcode scrambling
    this.hadWritten = false;  // a write since the last opcode fetch
    this.irqLine = false;     // level-triggered IRQ input
    this.nmiPending = false;  // set on an NMI edge
    // the I flag the interrupt poll sees: the 6502 polls before CLI, SEI and
    // PLP change I, so their new value only counts after the next instruction
    this.pollI = I;
    // MAME samples interrupt inputs at the start of every bus cycle but the
    // opcode fetch and a taken same-page branch's last: brAt is the end cycle
    // of such a branch, so the last sample was at cycles - 2 after one and
    // cycles - 1 otherwise. An interrupt raised later than that is seen one
    // instruction late (deferInt, set by whoever raises it).
    this.brAt = -1;
    this.deferInt = false;
  }

  // last cycle the interrupt inputs were sampled at
  sampleAt() { return this.brAt === this.cycles ? this.cycles - 2 : this.cycles - 1; }

  // raise an interrupt input at cycle t (between instructions, t <= cycles)
  raised(t) { if (t > this.sampleAt()) this.deferInt = true; }

  reset() {
    this.pc = this.read16(0xfffc);
    this.s = 0xfd;
    this.p = U | I;
  }

  read(addr) { return this.bus.read(addr & 0xffff, this.cycles) & 0xff; }
  write(addr, value) { this.hadWritten = true; this.bus.write(addr & 0xffff, value & 0xff, this.cycles); }

  // the opcode fetch (6502 SYNC cycle); MAME's deco_cpu7 read_sync
  fetchOp(addr) {
    let op = this.bus.read(addr & 0xffff, this.cycles) & 0xff;
    if (this.hadWritten) {
      this.hadWritten = false;
      if (this.decrypt && (addr & 0x0104) === 0x0104) op = unscramble(op);
    }
    return op;
  }

  // interrupt entry: the 6502 fetches (and discards) the next opcode before
  // pushing PC and P, which clears the CPU-7's write flag; the pushes set it
  // again, so the handler's first opcode can be unscrambled
  interrupt(vector) {
    this.fetchOp(this.pc);
    this.cycles += 7;
    this.push(this.pc >> 8);
    this.push(this.pc & 0xff);
    this.push((this.p & ~B) | U);
    this.p |= I;
    this.pc = this.read16(vector);
  }

  // take a pending NMI, else a pending unmasked IRQ; true if one was taken
  serviceInterrupts() {
    if (this.deferInt) { this.deferInt = false; return false; }
    if (this.nmiPending) { this.nmiPending = false; this.interrupt(0xfffa); this.pollI = I; return true; }
    if (this.irqLine && !this.pollI) { this.interrupt(0xfffe); this.pollI = I; return true; }
    return false;
  }
  read16(addr) { return this.read(addr) | (this.read((addr + 1) & 0xffff) << 8); }
  push(v) { this.write(0x100 | this.s, v); this.s = (this.s - 1) & 0xff; }
  pull() { this.s = (this.s + 1) & 0xff; return this.read(0x100 | this.s); }
  setNZ(v) { this.p = (this.p & ~(N | Z)) | (v & N) | (v === 0 ? Z : 0); return v; }
  flag(f) { return (this.p & f) !== 0; }
  setFlag(f, on) { this.p = on ? (this.p | f) : (this.p & ~f); }

  // addressing modes return an effective address and add page-cross penalties where relevant
  imm() { return this.pc++ & 0xffff; }
  zp() { return this.read(this.pc++); }
  zpx() { return (this.read(this.pc++) + this.x) & 0xff; }
  zpy() { return (this.read(this.pc++) + this.y) & 0xff; }
  abs() { const a = this.read16(this.pc); this.pc += 2; return a; }
  absx(penalty) { const b = this.read16(this.pc); this.pc += 2; const a = (b + this.x) & 0xffff; if (penalty && (a & 0xff00) !== (b & 0xff00)) this.cycles += 1; return a; }
  absy(penalty) { const b = this.read16(this.pc); this.pc += 2; const a = (b + this.y) & 0xffff; if (penalty && (a & 0xff00) !== (b & 0xff00)) this.cycles += 1; return a; }
  indx() { const z = (this.read(this.pc++) + this.x) & 0xff; return this.read(z) | (this.read((z + 1) & 0xff) << 8); }
  indy(penalty) { const z = this.read(this.pc++); const b = this.read(z) | (this.read((z + 1) & 0xff) << 8); const a = (b + this.y) & 0xffff; if (penalty && (a & 0xff00) !== (b & 0xff00)) this.cycles += 1; return a; }

  // effective addresses for translated code (operands known), with the same
  // page-crossing penalties as the addressing modes above
  indexed(base, index) { const a = (base + index) & 0xffff; if ((a & 0xff00) !== (base & 0xff00)) this.cycles += 1; return a; }
  indirectX(z) { z = (z + this.x) & 0xff; return this.read(z) | (this.read((z + 1) & 0xff) << 8); }
  indirectY(z, penalty) { const b = this.read(z) | (this.read((z + 1) & 0xff) << 8); const a = (b + this.y) & 0xffff; if (penalty && (a & 0xff00) !== (b & 0xff00)) this.cycles += 1; return a; }

  // NMOS decimal mode: Z from the binary sum, N and V from the half-adjusted
  // sum, C from the decimal result
  adcDecimal(v) {
    const c = this.p & C;
    const bin = (this.a + v + c) & 0xff;
    let lo = (this.a & 0x0f) + (v & 0x0f) + c;
    if (lo > 9) lo += 6;
    let r = (this.a & 0xf0) + (v & 0xf0) + (lo > 0x0f ? 0x10 : 0) + (lo & 0x0f);
    this.setFlag(Z, bin === 0);
    this.setFlag(N, (r & 0x80) !== 0);
    this.setFlag(V, (~(this.a ^ v) & (this.a ^ r) & 0x80) !== 0);
    if ((r & 0x1f0) > 0x90) r += 0x60;
    this.setFlag(C, r > 0xff);
    this.a = r & 0xff;
  }
  sbcDecimal(v) {
    const c = this.p & C;
    const bin = this.a - v - (1 - c);
    let lo = (this.a & 0x0f) - (v & 0x0f) - (1 - c);
    let hi = (this.a >> 4) - (v >> 4);
    if (lo < 0) { lo -= 6; hi -= 1; }
    if (hi < 0) hi -= 6;
    this.setFlag(C, bin >= 0);
    this.setFlag(V, ((this.a ^ v) & (this.a ^ bin) & 0x80) !== 0);
    this.setNZ(bin & 0xff);
    this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
  }
  adc(v) {
    if (this.flag(D)) { this.adcDecimal(v); return; }
    const r = this.a + v + (this.p & C);
    this.setFlag(C, r > 0xff);
    this.setFlag(V, (~(this.a ^ v) & (this.a ^ r) & 0x80) !== 0);
    this.a = this.setNZ(r & 0xff);
  }
  sbc(v) { if (this.flag(D)) this.sbcDecimal(v); else this.adc(v ^ 0xff); }
  cmp(reg, v) { const r = (reg - v) & 0x1ff; this.setFlag(C, reg >= v); this.setNZ(r & 0xff); }
  bit(v) { this.setFlag(Z, (this.a & v) === 0); this.setFlag(N, (v & 0x80) !== 0); this.setFlag(V, (v & 0x40) !== 0); }
  asl(v) { this.setFlag(C, (v & 0x80) !== 0); return this.setNZ((v << 1) & 0xff); }
  lsr(v) { this.setFlag(C, (v & 1) !== 0); return this.setNZ(v >> 1); }
  rol(v) { const c = this.p & C; this.setFlag(C, (v & 0x80) !== 0); return this.setNZ(((v << 1) | c) & 0xff); }
  ror(v) { const c = this.p & C; this.setFlag(C, (v & 1) !== 0); return this.setNZ((v >> 1) | (c << 7)); }
  branch(cond) {
    const off = this.read(this.pc++);
    if (!cond) return;
    const target = (this.pc + ((off ^ 0x80) - 0x80)) & 0xffff;
    if ((target & 0xff00) !== (this.pc & 0xff00)) this.cycles += 2;
    else { this.cycles += 1; this.brAt = this.cycles; }
    this.pc = target;
  }
  rmw(addr, fn) { this.write(addr, fn(this.read(addr))); }

  step() {
    const op = this.fetchOp(this.pc);
    const at = this.pc;
    this.pc = (this.pc + 1) & 0xffff;
    const entry = OPS[op];
    if (!entry) throw new Error(`unknown opcode $${op.toString(16)} at $${at.toString(16)}`);
    this.cycles += entry[0];
    const before = this.p & I;
    entry[1](this);
    this.pollI = op === 0x58 || op === 0x78 || op === 0x28 ? before : this.p & I;
    return op;
  }
}

// CPU-7 opcode unscrambling: MAME bitswap<8>(v, 6,5,3,4,2,7,1,0), i.e. new bit
// 7 = old bit 6, 6 = 5, 5 = 3, 4 = 4, 3 = 2, 2 = 7, 1 = 1, 0 = 0
export function unscramble(v) {
  return ((v >> 6) & 1) << 7 | ((v >> 5) & 1) << 6 | ((v >> 3) & 1) << 5 | ((v >> 4) & 1) << 4
    | ((v >> 2) & 1) << 3 | ((v >> 7) & 1) << 2 | (v & 0x03);
}

const OPS = new Array(256);
const def = (codes, cycles, fn) => { for (const [op, mode, cyc] of codes) OPS[op] = [cyc ?? cycles, (c) => fn(c, mode)]; };
const load = (c, mode) => c.read(ADDR[mode](c, true));
const ADDR = {
  imm: (c) => c.imm(), zp: (c) => c.zp(), zpx: (c) => c.zpx(), zpy: (c) => c.zpy(), abs: (c) => c.abs(),
  absx: (c, p) => c.absx(p), absy: (c, p) => c.absy(p), indx: (c) => c.indx(), indy: (c, p) => c.indy(p),
};
const readOps = (base) => [
  [base.imm, 'imm', 2], [base.zp, 'zp', 3], [base.zpx, 'zpx', 4], [base.abs, 'abs', 4],
  [base.absx, 'absx', 4], [base.absy, 'absy', 4], [base.indx, 'indx', 6], [base.indy, 'indy', 5],
].filter(([op]) => op !== undefined);

def(readOps({ imm: 0xa9, zp: 0xa5, zpx: 0xb5, abs: 0xad, absx: 0xbd, absy: 0xb9, indx: 0xa1, indy: 0xb1 }), 0, (c, m) => { c.a = c.setNZ(load(c, m)); });
def([[0xa2, 'imm', 2], [0xa6, 'zp', 3], [0xb6, 'zpy', 4], [0xae, 'abs', 4], [0xbe, 'absy', 4]], 0, (c, m) => { c.x = c.setNZ(load(c, m)); });
def([[0xa0, 'imm', 2], [0xa4, 'zp', 3], [0xb4, 'zpx', 4], [0xac, 'abs', 4], [0xbc, 'absx', 4]], 0, (c, m) => { c.y = c.setNZ(load(c, m)); });
def([[0x85, 'zp', 3], [0x95, 'zpx', 4], [0x8d, 'abs', 4], [0x9d, 'absx', 5], [0x99, 'absy', 5], [0x81, 'indx', 6], [0x91, 'indy', 6]], 0, (c, m) => { c.write(ADDR[m](c, false), c.a); });
def([[0x86, 'zp', 3], [0x96, 'zpy', 4], [0x8e, 'abs', 4]], 0, (c, m) => { c.write(ADDR[m](c, false), c.x); });
def([[0x84, 'zp', 3], [0x94, 'zpx', 4], [0x8c, 'abs', 4]], 0, (c, m) => { c.write(ADDR[m](c, false), c.y); });
def(readOps({ imm: 0x69, zp: 0x65, zpx: 0x75, abs: 0x6d, absx: 0x7d, absy: 0x79, indx: 0x61, indy: 0x71 }), 0, (c, m) => c.adc(load(c, m)));
def(readOps({ imm: 0xe9, zp: 0xe5, zpx: 0xf5, abs: 0xed, absx: 0xfd, absy: 0xf9, indx: 0xe1, indy: 0xf1 }), 0, (c, m) => c.sbc(load(c, m)));
def(readOps({ imm: 0x29, zp: 0x25, zpx: 0x35, abs: 0x2d, absx: 0x3d, absy: 0x39, indx: 0x21, indy: 0x31 }), 0, (c, m) => { c.a = c.setNZ(c.a & load(c, m)); });
def(readOps({ imm: 0x09, zp: 0x05, zpx: 0x15, abs: 0x0d, absx: 0x1d, absy: 0x19, indx: 0x01, indy: 0x11 }), 0, (c, m) => { c.a = c.setNZ(c.a | load(c, m)); });
def(readOps({ imm: 0x49, zp: 0x45, zpx: 0x55, abs: 0x4d, absx: 0x5d, absy: 0x59, indx: 0x41, indy: 0x51 }), 0, (c, m) => { c.a = c.setNZ(c.a ^ load(c, m)); });
def(readOps({ imm: 0xc9, zp: 0xc5, zpx: 0xd5, abs: 0xcd, absx: 0xdd, absy: 0xd9, indx: 0xc1, indy: 0xd1 }), 0, (c, m) => c.cmp(c.a, load(c, m)));
def([[0xe0, 'imm', 2], [0xe4, 'zp', 3], [0xec, 'abs', 4]], 0, (c, m) => c.cmp(c.x, load(c, m)));
def([[0xc0, 'imm', 2], [0xc4, 'zp', 3], [0xcc, 'abs', 4]], 0, (c, m) => c.cmp(c.y, load(c, m)));
def([[0x24, 'zp', 3], [0x2c, 'abs', 4]], 0, (c, m) => c.bit(load(c, m)));
const shift = (codes, fn) => {
  OPS[codes.acc] = [2, (c) => { c.a = fn(c, c.a); }];
  for (const [op, mode, cyc] of [[codes.zp, 'zp', 5], [codes.zpx, 'zpx', 6], [codes.abs, 'abs', 6], [codes.absx, 'absx', 7]]) {
    OPS[op] = [cyc, (c) => c.rmw(ADDR[mode](c, false), (v) => fn(c, v))];
  }
};
shift({ acc: 0x0a, zp: 0x06, zpx: 0x16, abs: 0x0e, absx: 0x1e }, (c, v) => c.asl(v));
shift({ acc: 0x4a, zp: 0x46, zpx: 0x56, abs: 0x4e, absx: 0x5e }, (c, v) => c.lsr(v));
shift({ acc: 0x2a, zp: 0x26, zpx: 0x36, abs: 0x2e, absx: 0x3e }, (c, v) => c.rol(v));
shift({ acc: 0x6a, zp: 0x66, zpx: 0x76, abs: 0x6e, absx: 0x7e }, (c, v) => c.ror(v));
def([[0xe6, 'zp', 5], [0xf6, 'zpx', 6], [0xee, 'abs', 6], [0xfe, 'absx', 7]], 0, (c, m) => c.rmw(ADDR[m](c, false), (v) => c.setNZ((v + 1) & 0xff)));
def([[0xc6, 'zp', 5], [0xd6, 'zpx', 6], [0xce, 'abs', 6], [0xde, 'absx', 7]], 0, (c, m) => c.rmw(ADDR[m](c, false), (v) => c.setNZ((v - 1) & 0xff)));

const imp = (op, cyc, fn) => { OPS[op] = [cyc, fn]; };
imp(0xe8, 2, (c) => { c.x = c.setNZ((c.x + 1) & 0xff); });
imp(0xca, 2, (c) => { c.x = c.setNZ((c.x - 1) & 0xff); });
imp(0xc8, 2, (c) => { c.y = c.setNZ((c.y + 1) & 0xff); });
imp(0x88, 2, (c) => { c.y = c.setNZ((c.y - 1) & 0xff); });
imp(0xaa, 2, (c) => { c.x = c.setNZ(c.a); });
imp(0x8a, 2, (c) => { c.a = c.setNZ(c.x); });
imp(0xa8, 2, (c) => { c.y = c.setNZ(c.a); });
imp(0x98, 2, (c) => { c.a = c.setNZ(c.y); });
imp(0xba, 2, (c) => { c.x = c.setNZ(c.s); });
imp(0x9a, 2, (c) => { c.s = c.x; });
imp(0x48, 3, (c) => c.push(c.a));
imp(0x68, 4, (c) => { c.a = c.setNZ(c.pull()); });
imp(0x08, 3, (c) => c.push(c.p | B | U));
imp(0x28, 4, (c) => { c.p = (c.pull() & ~B) | U; });
imp(0x18, 2, (c) => c.setFlag(C, false));
imp(0x38, 2, (c) => c.setFlag(C, true));
imp(0x58, 2, (c) => c.setFlag(I, false));
imp(0x78, 2, (c) => c.setFlag(I, true));
imp(0xb8, 2, (c) => c.setFlag(V, false));
imp(0xd8, 2, (c) => c.setFlag(D, false));
imp(0xf8, 2, (c) => c.setFlag(D, true));
imp(0xea, 2, () => {});
imp(0x4c, 3, (c) => { c.pc = c.abs(); });
imp(0x6c, 5, (c) => { const p = c.abs(); c.pc = c.read(p) | (c.read((p & 0xff00) | ((p + 1) & 0xff)) << 8); });
imp(0x20, 6, (c) => { const t = c.abs(); const r = (c.pc - 1) & 0xffff; c.push(r >> 8); c.push(r & 0xff); c.pc = t; });
imp(0x60, 6, (c) => { const lo = c.pull(); const hi = c.pull(); c.pc = (((hi << 8) | lo) + 1) & 0xffff; });
imp(0x40, 6, (c) => { c.p = (c.pull() & ~B) | U; const lo = c.pull(); const hi = c.pull(); c.pc = (hi << 8) | lo; });
imp(0x00, 7, (c) => { c.pc = (c.pc + 1) & 0xffff; c.push(c.pc >> 8); c.push(c.pc & 0xff); c.push(c.p | B | U); c.setFlag(I, true); c.pc = c.read16(0xfffe); });
imp(0x10, 2, (c) => c.branch(!c.flag(N)));
imp(0x30, 2, (c) => c.branch(c.flag(N)));
imp(0x50, 2, (c) => c.branch(!c.flag(V)));
imp(0x70, 2, (c) => c.branch(c.flag(V)));
imp(0x90, 2, (c) => c.branch(!c.flag(C)));
imp(0xb0, 2, (c) => c.branch(c.flag(C)));
imp(0xd0, 2, (c) => c.branch(!c.flag(Z)));
imp(0xf0, 2, (c) => c.branch(c.flag(Z)));
