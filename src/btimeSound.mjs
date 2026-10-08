// Burger Time sound board: a 6502 at 500 kHz with two AY-3-8910s (MAME
// btime audio_map and machine config).
//
//   $0000-$03FF  RAM, mirrored to $1FFF
//   $2000 W      AY #1 data        $4000 W  AY #1 address
//   $6000 W      AY #2 data        $8000 W  AY #2 address
//   $A000 R      sound command latch (reading it drops the IRQ)
//   $C000 W      bit 0: NMI enable
//   $E000-$FFFF  program ROM (4K, mirrored)
// (each decoded in an $2000 window)
//
// Timing: one sound CPU cycle is three main CPU cycles, so a frame is 8704
// cycles and a line 32. The NMI is enable AND 8VCK, the screen's vertical
// count bit 3 (MAME's 8-line scanline timer, first firing at vpos 0), taken on
// its rising edges: 17 a frame. The main CPU's command write raises the IRQ.
// The AYs step at clock/8 = 187.5 kHz, i.e. 3 steps every 8 cycles.
import { AY8910 } from './ay8910.mjs';

export const SOUND_CYCLES_PER_FRAME = 8704;
export const SOUND_CYCLES_PER_LINE = 32;

// 8VCK at absolute line n (n = 0 at power-on, which is VBLANK start = vpos 248)
export function vck8(n) {
  if (n < 24) return 0; // before the timer's first firing at vpos 0
  const vpos = (n + 248) % 272;
  return (vpos >> 3) & 1;
}

export class SoundBus {
  constructor(programRom) {
    this.rom = programRom;
    this.ram = new Uint8Array(0x400);
    this.latch = 0;
    this.nmiEnable = 0;
    this.cpu = null;        // set by the machine (IRQ line, NMI edges)
    this.ay = [new AY8910([5000, 5000, 5000]), new AY8910([1000, 5000, 5000])];
    this.writes = [];       // AY writes this slice: [cycle, chip, isAddress, value]
    this.onNmiLine = null;  // (cycles) => void, when the enable changes
    this.journal = null;    // when set, RAM writes record [addr, previous value]
  }

  read(addr, cycles) {
    if (addr < 0x2000) return this.ram[addr & 0x3ff];
    if (addr >= 0xe000) return this.rom[addr];
    if (addr >= 0xa000 && addr < 0xc000) { this.cpu.irqLine = false; return this.latch; }
    return 0;
  }

  write(addr, value, cycles) {
    if (addr < 0x2000) {
      if (this.journal) this.journal.push([addr & 0x3ff, this.ram[addr & 0x3ff]]);
      this.ram[addr & 0x3ff] = value;
      return;
    }
    switch (addr >> 13) {
      case 1: this.writes.push([cycles - 1, 0, false, value]); break;
      case 2: this.writes.push([cycles - 1, 0, true, value]); break;
      case 3: this.writes.push([cycles - 1, 1, false, value]); break;
      case 4: this.writes.push([cycles - 1, 1, true, value]); break;
      case 6: this.nmiEnable = value & 1; if (this.onNmiLine) this.onNmiLine(cycles - 1); break;
      default: break;
    }
  }
}

// Runs a sound CPU (interpreted or translated) through one frame's worth of
// cycles: command latch writes and 8VCK edges are applied between
// instructions at their cycle; runTo(cycle) runs whole instructions until the
// CPU's cycle count reaches it.
export class SoundTimeline {
  constructor(cpu, bus, runTo) {
    this.cpu = cpu;
    this.bus = bus;
    this.runTo = runTo;
    this.frame = 0;
    this.nmiLine = 0;
    bus.cpu = cpu;
    bus.onNmiLine = (t) => this.updateNmi(this.lineAt(t), t);
  }

  lineAt(cycle) { return Math.floor(cycle / SOUND_CYCLES_PER_LINE); }

  updateNmi(line, t) {
    const level = this.bus.nmiEnable & vck8(line);
    if (level && !this.nmiLine && this.cpu.cycles > 0) { this.cpu.nmiPending = true; this.cpu.raised(t); }
    this.nmiLine = level;
  }

  // commands: [mainCycle, value] written by the main CPU during this frame
  runFrame(commands) {
    const start = this.frame * SOUND_CYCLES_PER_FRAME;
    const end = start + SOUND_CYCLES_PER_FRAME;
    const events = [];
    for (const [mainCycle, value] of commands) events.push([Math.ceil(mainCycle / 3), 0, value]);
    // 8VCK changes every 8 lines
    for (let line = this.lineAt(start); line < this.lineAt(end); line += 1) {
      if (line % 8 === 0 || line === 24) events.push([line * SOUND_CYCLES_PER_LINE + Number(globalThis.process?.env?.VCK_OFFSET ?? 0), 1, line]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.bus.writes = [];
    for (const [t, kind, arg] of events) {
      this.runTo(Math.max(t, 0));
      if (kind === 0) { this.bus.latch = arg; if (!this.cpu.irqLine) { this.cpu.irqLine = true; this.cpu.raised(t); } }
      else this.updateNmi(arg, t);
    }
    this.runTo(end);
    this.frame += 1;
  }
}
