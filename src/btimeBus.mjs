// Burger Time main board: the main CPU's memory map (MAME btime_map).
//
//   $0000-$07FF  RAM
//   $0C00-$0C0F  palette RAM (16 entries, BGR 2-3-3, inverted)
//   $1000-$13FF  video RAM (32x32 character codes; sprites live in row 0)
//   $1400-$17FF  colour RAM (bits 0-1: character bank)
//   $1800-$1FFF  the same two RAMs with X and Y swapped
//   $4000 R      P1 controls          (active low)
//   $4001 R      P2 controls          (active low)
//   $4002 R      SYSTEM: starts, tilt (active low), coins (active high)
//         W      video control: bit 0 = flip screen
//   $4003 R      DSW1; bit 7 = VBLANK
//         W      sound command latch (IRQ to the sound CPU)
//   $4004 R      DSW2
//         W      background control: bit 4 = background on, bit 2 = map bank,
//                bits 0-1 = page
//   $C000-$FFFF  program ROM
//
// Timing (MAME's screen: 6 MHz pixel clock, 384 x 272 total, visible lines
// 8-247): the CPU runs at 1.5 MHz, so a line is 96 cycles and a frame 26112.
// VBLANK is 32 lines (248-271 and 0-7). Frames here start at VBLANK start, as
// MAME's screen does at power-on, so VBLANK is the first 3072 cycles of each.

export const CYCLES_PER_LINE = 96;
export const LINES_PER_FRAME = 272;
export const CYCLES_PER_FRAME = CYCLES_PER_LINE * LINES_PER_FRAME;

export const VBLANK_CYCLES = 32 * CYCLES_PER_LINE;

export function inVblank(cycle) {
  return cycle % CYCLES_PER_FRAME < VBLANK_CYCLES;
}

// swapped-coordinate port: offset = 32*x + y addresses RAM 32*y + x
const swap = (offset) => ((offset & 31) << 5) | (offset >> 5);

export class MainBus {
  constructor(programRom) {
    this.rom = programRom;            // 64K image, $C000-$FFFF loaded
    this.ram = new Uint8Array(0x800);
    this.palette = new Uint8Array(16);
    this.vram = new Uint8Array(0x400);
    this.cram = new Uint8Array(0x400);
    this.flip = 0;
    this.bgControl = 0;
    // inputs (idle values: everything released, factory DIP settings)
    this.p1 = 0xff;
    this.p2 = 0xff;
    this.system = 0x3f;
    this.dsw1 = 0x3f;
    this.dsw2 = 0xeb;
    // sound commands written this frame: [cycle, value]
    this.soundCommands = [];
    // when set, write() records [addr, previous value] (see OracleMachine)
    this.journal = null;
  }

  // what a write to addr would overwrite
  peek(addr) { return addr >= 0x4000 && addr < 0x4005 ? 0 : this.read(addr, 0); }

  read(addr, cycles) {
    if (addr < 0x0800) return this.ram[addr];
    if (addr >= 0xc000) return this.rom[addr];
    if (addr >= 0x1000 && addr < 0x2000) {
      if (addr < 0x1400) return this.vram[addr - 0x1000];
      if (addr < 0x1800) return this.cram[addr - 0x1400];
      if (addr < 0x1c00) return this.vram[swap(addr - 0x1800)];
      return this.cram[swap(addr - 0x1c00)];
    }
    if (addr >= 0x0c00 && addr < 0x0c10) return this.palette[addr - 0x0c00];
    switch (addr) {
      case 0x4000: return this.p1;
      case 0x4001: return this.p2;
      case 0x4002: return this.system;
      case 0x4003: return (this.dsw1 & 0x7f) | (inVblank(cycles - 1) ? 0x80 : 0);
      case 0x4004: return this.dsw2;
      default: return addr >= 0xb000 ? this.rom[addr] : 0;
    }
  }

  write(addr, value, cycles) {
    if (this.journal) this.journal.push([addr, this.peek(addr)]);
    if (addr < 0x0800) { this.ram[addr] = value; return; }
    if (addr >= 0x1000 && addr < 0x2000) {
      if (addr < 0x1400) this.vram[addr - 0x1000] = value;
      else if (addr < 0x1800) this.cram[addr - 0x1400] = value;
      else if (addr < 0x1c00) this.vram[swap(addr - 0x1800)] = value;
      else this.cram[swap(addr - 0x1c00)] = value;
      return;
    }
    if (addr >= 0x0c00 && addr < 0x0c10) { this.palette[addr - 0x0c00] = value; return; }
    switch (addr) {
      case 0x4002: this.flip = value & 1; break;
      case 0x4003: this.soundCommands.push([cycles - 1, value]); break;
      case 0x4004: this.bgControl = value; break;
      default: break;
    }
  }
}
