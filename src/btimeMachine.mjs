// The game's main board: the translated main CPU program (btimeMainRecomp)
// on the board's memory map, with the ROM's data bytes in place of the ROM.
import { M6502 } from './cpu6502.mjs';
import { MainBus, CYCLES_PER_FRAME } from './btimeBus.mjs';
import { run, RESET_KEY } from './btimeMainRecomp.mjs';
import { mainDataImage } from './btimeMainData.mjs';

export class BtimeMachine {
  constructor() {
    this.bus = new MainBus(mainDataImage());
    this.cpu = new M6502(this.bus);
    this.cpu.s = 0xfd;
    this.cpu.p = 0x24;
    this.cpu.key = RESET_KEY;
    this.cpu.irqHold = true; // the coin IRQ is held until taken (MAME HOLD_LINE)
    this.frame = 0;
  }

  // coins are active high; a rising edge raises the IRQ line until taken
  setSystem(value) {
    const rising = value & ~this.bus.system & 0xc0;
    this.bus.system = value;
    if (rising) this.cpu.irqLine = true;
  }

  runFrame() {
    this.bus.soundCommands = [];
    run(this.cpu, this.bus, (this.frame + 1) * CYCLES_PER_FRAME);
    this.frame += 1;
  }
}
