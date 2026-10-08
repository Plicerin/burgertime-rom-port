// Dev-only oracle: interprets the real Burger Time ROMs (rom/, git-ignored) on
// the 6502 core with the board's memory map. The translated game is checked
// against this, and this is checked against MAME (tools/compare-mame.mjs).
import { readFileSync } from 'node:fs';
import { M6502 } from '../src/cpu6502.mjs';
import { MainBus, CYCLES_PER_FRAME } from '../src/btimeBus.mjs';

const ROM_DIR = new URL('../rom/', import.meta.url);
const load = (name) => new Uint8Array(readFileSync(new URL(name, ROM_DIR)));

export function loadRoms() {
  const main = new Uint8Array(0x10000);
  main.set(load('aa04.9b'), 0xc000);
  main.set(load('aa06.13b'), 0xd000);
  main.set(load('aa05.10b'), 0xe000);
  main.set(load('aa07.15b'), 0xf000);
  const sound = new Uint8Array(0x10000);
  const ab14 = load('ab14.12h');
  sound.set(ab14, 0xe000);
  sound.set(ab14, 0xf000);
  const gfx1 = new Uint8Array(0x6000);
  ['aa12.7k', 'ab13.9k', 'ab10.10k', 'ab11.12k', 'aa8.13k', 'ab9.15k'].forEach((n, i) => gfx1.set(load(n), i * 0x1000));
  const gfx2 = new Uint8Array(0x1800);
  ['ab00.1b', 'ab01.3b', 'ab02.4b'].forEach((n, i) => gfx2.set(load(n), i * 0x800));
  const bgMap = load('ab03.6b');
  return { main, sound, gfx1, gfx2, bgMap };
}

export class OracleMachine {
  constructor(roms = loadRoms(), { resetCycles = 0 } = {}) {
    this.roms = roms;
    this.bus = new MainBus(roms.main);
    this.cpu = new M6502(this.bus);
    this.cpu.decrypt = true;
    this.cpu.reset();
    this.cpu.cycles = resetCycles;
    this.frame = 0;
    this.coinLatch = 0;
    this.onInstruction = null; // (cpu, pc) hook for tracing
  }

  // coin inputs are active high; a rising edge raises the IRQ line until the
  // CPU takes it (MAME HOLD_LINE)
  setSystem(value) {
    const rising = value & ~this.bus.system & 0xc0;
    this.bus.system = value;
    if (rising) this.cpu.irqLine = true;
  }

  // run to the end of the current frame (the next VBLANK start)
  runFrame() {
    const cpu = this.cpu;
    const end = (this.frame + 1) * CYCLES_PER_FRAME;
    this.bus.soundCommands = [];
    const bus = this.bus;
    while (cpu.cycles < end) {
      // an instruction that may end past the boundary has its writes recorded
      bus.journal = cpu.cycles + 8 > end ? [] : null;
      if (cpu.serviceInterrupts()) { cpu.irqLine = false; continue; }
      if (this.onInstruction) this.onInstruction(cpu, cpu.pc);
      cpu.step();
    }
    // writes made by the instruction that ended past the boundary (MAME's
    // CPU stops mid-instruction there, before an instruction's last-cycle write)
    this.lateWrites = cpu.cycles > end ? bus.journal : [];
    bus.journal = null;
    this.frame += 1;
  }

  // RAM, palette, video and colour RAM as they were at the frame boundary
  snapshot() {
    const b = this.bus;
    const s = { ram: b.ram.slice(), palette: b.palette.slice(), vram: b.vram.slice(), cram: b.cram.slice() };
    const shadow = Object.assign(Object.create(Object.getPrototypeOf(b)), b, s, { journal: null, soundCommands: [] });
    for (let i = this.lateWrites.length - 1; i >= 0; i -= 1) {
      const [addr, old] = this.lateWrites[i];
      if (addr < 0x4000 || addr > 0x4004) shadow.write(addr, old, 0);
    }
    return s;
  }
}
