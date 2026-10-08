// Input scripts shared by the MAME recorder (tools/mame/dump.lua) and the
// oracle: lines "frame port field value". Ports and fields use MAME's names,
// e.g. "60 SYSTEM Coin 1 1".
import { readFileSync } from 'node:fs';

// MAME applies a value the Lua script sets at the end of frame f when frame
// f + 1 ends, so the oracle applies entry f after frame f + MAME_INPUT_LAG
export const MAME_INPUT_LAG = 1;

// port -> field -> [bus property, bit, active high?]
export const FIELDS = {
  P1: { 'P1 Right': ['p1', 0x01], 'P1 Left': ['p1', 0x02], 'P1 Up': ['p1', 0x04], 'P1 Down': ['p1', 0x08], 'P1 Button 1': ['p1', 0x10] },
  SYSTEM: { '1 Player Start': ['system', 0x01], '2 Players Start': ['system', 0x02], 'Coin 1': ['system', 0x40, true], 'Coin 2': ['system', 0x80, true] },
};

export function readInputScript(path) {
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^(\d+)\s+(\S+)\s+(.+?)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const f = Number(m[1]);
    if (!map.has(f)) map.set(f, []);
    map.get(f).push([m[2], m[3], Number(m[4])]);
  }
  return map;
}

// field value 1 = pressed / coin in
export function applyInputs(machine, events) {
  for (const [port, field, value] of events ?? []) {
    const def = FIELDS[port]?.[field];
    if (!def) throw new Error(`unknown input ${port} ${field}`);
    const [prop, bit, activeHigh] = def;
    const on = activeHigh ? value !== 0 : value === 0;
    const next = on ? machine.bus[prop] | bit : machine.bus[prop] & ~bit;
    if (prop === 'system') machine.setSystem(next);
    else machine.bus[prop] = next;
  }
}
