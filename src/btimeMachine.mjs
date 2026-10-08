// The game's main board: the translated main CPU program (btimeMainRecomp)
// on the board's memory map, with the ROM's data bytes in place of the ROM.
import { M6502, RESET_CYCLES } from './cpu6502.mjs';
import { MainBus, CYCLES_PER_FRAME } from './btimeBus.mjs';
import { run, RESET_KEY } from './btimeMainRecomp.mjs';
import { mainDataImage } from './btimeMainData.mjs';
import { run as runSound, RESET_KEY as SOUND_RESET_KEY } from './btimeSoundRecomp.mjs';
import { soundDataImage } from './btimeSoundData.mjs';
import { SoundBus, SoundTimeline } from './btimeSound.mjs';

export class BtimeMachine {
  constructor() {
    this.bus = new MainBus(mainDataImage());
    this.cpu = new M6502(this.bus);
    this.cpu.s = 0xfd;
    this.cpu.p = 0x24;
    this.cpu.key = RESET_KEY;
    this.cpu.cycles = RESET_CYCLES;
    this.cpu.irqHold = true; // the coin IRQ is held until taken (MAME HOLD_LINE)
    this.frame = 0;
  }

  // coins are active high; a rising edge raises the IRQ line until taken
  setSystem(value) {
    const rising = value & ~this.bus.system & 0xc0;
    this.bus.system = value;
    if (rising && !this.cpu.irqLine) { this.cpu.irqLine = true; this.cpu.raised(this.frame * CYCLES_PER_FRAME); }
  }

  runFrame() {
    this.bus.soundCommands = [];
    run(this.cpu, this.bus, (this.frame + 1) * CYCLES_PER_FRAME);
    this.frame += 1;
  }
}

// The sound board: the translated sound CPU program (btimeSoundRecomp) on the
// sound board's map, driven frame by frame by the main CPU's commands.
export class BtimeSound {
  constructor() {
    this.bus = new SoundBus(soundDataImage());
    this.cpu = new M6502(this.bus);
    this.cpu.s = 0xfd;
    this.cpu.p = 0x24;
    this.cpu.key = SOUND_RESET_KEY;
    this.cpu.cycles = RESET_CYCLES;
    this.cpu.irqHold = false; // the command latch holds the IRQ until read
    this.timeline = new SoundTimeline(this.cpu, this.bus, (t) => runSound(this.cpu, this.bus, t));
  }

  // commands: the main CPU's [cycle, value] writes for the frame
  runFrame(commands) { this.timeline.runFrame(commands); }
}
