// 6502 disassembler shared by the dev tools.
//   node tools/disasm.mjs <from> <to>   (main CPU, hex addresses)
// With a trace map (tools/trace.mjs), opcodes the CPU-7 unscrambles are shown
// unscrambled and marked '*'.
import { unscramble } from '../src/cpu6502.mjs';

export const OPC = {};
const add = (mn, list) => { for (const [op, mode, cyc] of list) OPC[op] = [mn, mode, cyc]; };
const rd = (imm, zp, zpx, abs, absx, absy, indx, indy) => [[imm, 'imm', 2], [zp, 'zp', 3], [zpx, 'zpx', 4], [abs, 'abs', 4], [absx, 'absx', 4], [absy, 'absy', 4], [indx, 'indx', 6], [indy, 'indy', 5]];
add('lda', rd(0xa9, 0xa5, 0xb5, 0xad, 0xbd, 0xb9, 0xa1, 0xb1));
add('adc', rd(0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71));
add('sbc', rd(0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1));
add('and', rd(0x29, 0x25, 0x35, 0x2d, 0x3d, 0x39, 0x21, 0x31));
add('ora', rd(0x09, 0x05, 0x15, 0x0d, 0x1d, 0x19, 0x01, 0x11));
add('eor', rd(0x49, 0x45, 0x55, 0x4d, 0x5d, 0x59, 0x41, 0x51));
add('cmp', rd(0xc9, 0xc5, 0xd5, 0xcd, 0xdd, 0xd9, 0xc1, 0xd1));
add('ldx', [[0xa2, 'imm', 2], [0xa6, 'zp', 3], [0xb6, 'zpy', 4], [0xae, 'abs', 4], [0xbe, 'absy', 4]]);
add('ldy', [[0xa0, 'imm', 2], [0xa4, 'zp', 3], [0xb4, 'zpx', 4], [0xac, 'abs', 4], [0xbc, 'absx', 4]]);
add('sta', [[0x85, 'zp', 3], [0x95, 'zpx', 4], [0x8d, 'abs', 4], [0x9d, 'absx', 5], [0x99, 'absy', 5], [0x81, 'indx', 6], [0x91, 'indy', 6]]);
add('stx', [[0x86, 'zp', 3], [0x96, 'zpy', 4], [0x8e, 'abs', 4]]);
add('sty', [[0x84, 'zp', 3], [0x94, 'zpx', 4], [0x8c, 'abs', 4]]);
add('cpx', [[0xe0, 'imm', 2], [0xe4, 'zp', 3], [0xec, 'abs', 4]]);
add('cpy', [[0xc0, 'imm', 2], [0xc4, 'zp', 3], [0xcc, 'abs', 4]]);
add('bit', [[0x24, 'zp', 3], [0x2c, 'abs', 4]]);
for (const [mn, acc, zp, zpx, abs, absx] of [['asl', 0x0a, 0x06, 0x16, 0x0e, 0x1e], ['lsr', 0x4a, 0x46, 0x56, 0x4e, 0x5e], ['rol', 0x2a, 0x26, 0x36, 0x2e, 0x3e], ['ror', 0x6a, 0x66, 0x76, 0x6e, 0x7e]]) {
  add(mn, [[acc, 'acc', 2], [zp, 'zp', 5], [zpx, 'zpx', 6], [abs, 'abs', 6], [absx, 'absx', 7]]);
}
add('inc', [[0xe6, 'zp', 5], [0xf6, 'zpx', 6], [0xee, 'abs', 6], [0xfe, 'absx', 7]]);
add('dec', [[0xc6, 'zp', 5], [0xd6, 'zpx', 6], [0xce, 'abs', 6], [0xde, 'absx', 7]]);
for (const [mn, op, cyc] of [['inx', 0xe8, 2], ['dex', 0xca, 2], ['iny', 0xc8, 2], ['dey', 0x88, 2], ['tax', 0xaa, 2], ['txa', 0x8a, 2], ['tay', 0xa8, 2], ['tya', 0x98, 2], ['tsx', 0xba, 2], ['txs', 0x9a, 2],
  ['pha', 0x48, 3], ['pla', 0x68, 4], ['php', 0x08, 3], ['plp', 0x28, 4], ['clc', 0x18, 2], ['sec', 0x38, 2], ['cli', 0x58, 2], ['sei', 0x78, 2], ['clv', 0xb8, 2], ['cld', 0xd8, 2], ['sed', 0xf8, 2], ['nop', 0xea, 2], ['rts', 0x60, 6], ['rti', 0x40, 6], ['brk', 0x00, 7]]) add(mn, [[op, 'imp', cyc]]);
add('jmp', [[0x4c, 'abs', 3], [0x6c, 'ind', 5]]);
add('jsr', [[0x20, 'abs', 6]]);
for (const [mn, op] of [['bpl', 0x10], ['bmi', 0x30], ['bvc', 0x50], ['bvs', 0x70], ['bcc', 0x90], ['bcs', 0xb0], ['bne', 0xd0], ['beq', 0xf0]]) add(mn, [[op, 'rel', 2]]);
export const SIZE = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, indx: 2, indy: 2, rel: 2, abs: 3, absx: 3, absy: 3, ind: 3 };

const hex = (v, n = 2) => v.toString(16).padStart(n, '0').toUpperCase();

export function operandText(mode, operand, next) {
  switch (mode) {
    case 'imp': return '';
    case 'acc': return 'A';
    case 'imm': return `#$${hex(operand)}`;
    case 'zp': return `$${hex(operand)}`;
    case 'zpx': return `$${hex(operand)},X`;
    case 'zpy': return `$${hex(operand)},Y`;
    case 'indx': return `($${hex(operand)},X)`;
    case 'indy': return `($${hex(operand)}),Y`;
    case 'abs': return `$${hex(operand, 4)}`;
    case 'absx': return `$${hex(operand, 4)},X`;
    case 'absy': return `$${hex(operand, 4)},Y`;
    case 'ind': return `($${hex(operand, 4)})`;
    case 'rel': return `$${hex((next + ((operand ^ 0x80) - 0x80)) & 0xffff, 4)}`;
    default: return '?';
  }
}

// decode one instruction; scrambled = the opcode byte is unscrambled first
export function decode(mem, addr, scrambled = false) {
  const raw = mem[addr];
  const op = scrambled ? unscramble(raw) : raw;
  const def = OPC[op];
  if (!def) return { addr, op, raw, size: 1, mn: '???', mode: 'imp', cyc: 0, operand: 0, text: `.byte $${hex(raw)}` };
  const [mn, mode, cyc] = def;
  const size = SIZE[mode];
  const operand = size === 1 ? 0 : size === 2 ? mem[(addr + 1) & 0xffff] : mem[(addr + 1) & 0xffff] | (mem[(addr + 2) & 0xffff] << 8);
  return { addr, op, raw, size, mn, mode, cyc, operand, scrambled, text: `${mn.toUpperCase()} ${operandText(mode, operand, (addr + size) & 0xffff)}`.trim() };
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const { loadRoms } = await import('./oracle.mjs');
  const mem = loadRoms().main;
  const from = parseInt(process.argv[2], 16), to = parseInt(process.argv[3], 16);
  const marks = process.argv[4] ? new Set(process.argv[4].split(',').map((s) => parseInt(s, 16))) : new Set();
  for (let a = from; a < to;) {
    const d = decode(mem, a, marks.has(a));
    const bytes = [...mem.subarray(a, a + d.size)].map((b) => hex(b)).join(' ');
    const pat = (a & 0x104) === 0x104 ? '!' : ' ';
    console.log(`${hex(a, 4)}${pat} ${bytes.padEnd(9)} ${d.scrambled ? '*' : ' '}${d.text}`);
    a += d.size;
  }
}
