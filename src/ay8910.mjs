// AY-3-8910 PSG, ported from MAME's ay8910.cpp (AY type, three separate
// outputs, AY8910_DISCRETE_OUTPUT: un-normalised resistor-network levels).
// tick() advances one internal step at clock/8 (187.5 kHz for Burger Time's
// 1.5 MHz chips) and leaves each channel's output level in out[0..2]: the
// fraction of the 5 V supply MAME's resistor model gives for that channel's
// load.

// MAME ay8910_param (RL = 2000 model; r_up, r_down, 16 level resistances)
const R_UP = 800000, R_DOWN = 8000000;
const RES = [15950, 15350, 15090, 14760, 14275, 13620, 12890, 11370, 10600, 8590, 7190, 5985, 4820, 3945, 3017, 2345];

// build_single_table(rl, ay8910_param, normalize = 0, zero_is_off)
function levelTable(rl, zeroIsOff) {
  const tab = new Float64Array(16);
  for (let j = 0; j < 16; j += 1) {
    let rt = 1 / R_DOWN + 1 / rl;
    let rw = 1 / RES[j];
    rt += 1 / RES[j];
    if (!(zeroIsOff && j === 0)) { rw += 1 / R_UP; rt += 1 / R_UP; }
    tab[j] = rw / rt;
  }
  return tab;
}

export class AY8910 {
  // loads: the resistor load on each channel's output, in ohms
  constructor(loads = [1000, 1000, 1000]) {
    this.volTable = loads.map((rl) => levelTable(rl, true));  // zero_is_off for the AY type
    this.envTable = loads.map((rl) => levelTable(rl, false));
    this.regs = new Uint8Array(16);
    this.out = new Float64Array(3);
    this.portA = 0xff;
    this.onPortA = null;
    this.reset();
  }

  reset() {
    this.active = false;
    this.latch = 0;
    this.rng = 1;
    this.tone = [0, 1, 2].map(() => ({ period: 0, volume: 0, count: 0, dutyCycle: 0, output: 0 }));
    this.env = { period: 0, count: 0, step: 0, volume: 0, hold: 0, alternate: 0, attack: 0, holding: 0 };
    this.countNoise = 0;
    this.prescaleNoise = 0;
    this.volEnabled = [0, 0, 0];
    this.lastEnable = 0xc0;
    for (let r = 0; r < 14; r += 1) this.writeReg(r, 0);
  }

  // bus side: BC1/BDIR decoded by the board into separate address/data writes
  address(value) {
    this.active = (value >> 4) === 0;
    if (this.active) this.latch = value & 0x0f;
  }

  data(value) {
    if (this.active) this.writeReg(this.latch, value);
  }

  writeReg(r, v) {
    const regs = this.regs;
    regs[r] = v;
    switch (r) {
      case 0: case 1: this.tone[0].period = regs[0] | ((regs[1] & 0x0f) << 8); break;
      case 2: case 3: this.tone[1].period = regs[2] | ((regs[3] & 0x0f) << 8); break;
      case 4: case 5: this.tone[2].period = regs[4] | ((regs[5] & 0x0f) << 8); break;
      case 8: this.tone[0].volume = v; break;
      case 9: this.tone[1].volume = v; break;
      case 10: this.tone[2].volume = v; break;
      case 11: case 12: this.env.period = regs[11] | (regs[12] << 8); break;
      case 7:
        if ((v & 0x40) !== (this.lastEnable & 0x40) && this.onPortA) this.onPortA(v & 0x40 ? regs[14] : 0xff);
        this.lastEnable = v;
        break;
      case 13: {
        const e = this.env;
        e.attack = v & 0x04 ? 0x0f : 0;
        if ((v & 0x08) === 0) { e.hold = 1; e.alternate = e.attack; }
        else { e.hold = v & 0x01; e.alternate = v & 0x02; }
        e.step = 0x0f;
        e.holding = 0;
        e.volume = e.step ^ e.attack;
        break;
      }
      case 14:
        if (regs[7] & 0x40 && this.onPortA) this.onPortA(v);
        break;
      default: break;
    }
  }

  tick() {
    const regs = this.regs;
    for (let ch = 0; ch < 3; ch += 1) {
      const t = this.tone[ch];
      const period = Math.max(1, t.period);
      t.count += 1;
      while (t.count >= period) {
        t.dutyCycle = (t.dutyCycle - 1) & 0x1f;
        t.output = t.dutyCycle & 1;
        t.count -= period;
      }
    }
    if (++this.countNoise >= (regs[6] & 0x1f)) {
      this.countNoise = 0;
      this.prescaleNoise ^= 1;
      if (!this.prescaleNoise) this.rng = (this.rng >>> 1) | (((this.rng ^ (this.rng >>> 3)) & 1) << 16);
    }
    const noise = this.rng & 1;
    for (let ch = 0; ch < 3; ch += 1) {
      this.volEnabled[ch] = (this.tone[ch].output | ((regs[7] >> ch) & 1)) & (noise | ((regs[7] >> (3 + ch)) & 1));
    }
    const e = this.env;
    if (!e.holding) {
      if (++e.count >= e.period * 2) {
        e.count = 0;
        e.step -= 1;
        if (e.step < 0) {
          if (e.hold) {
            if (e.alternate) e.attack ^= 0x0f;
            e.holding = 1;
            e.step = 0;
          } else {
            if (e.alternate && (e.step & 0x10)) e.attack ^= 0x0f;
            e.step &= 0x0f;
          }
        }
      }
    }
    e.volume = e.step ^ e.attack;
    for (let ch = 0; ch < 3; ch += 1) {
      const t = this.tone[ch];
      if (t.volume & 0x10) this.out[ch] = this.envTable[ch][this.volEnabled[ch] ? e.volume : 0];
      else this.out[ch] = this.volTable[ch][this.volEnabled[ch] ? t.volume & 0x0f : 0];
    }
  }
}
