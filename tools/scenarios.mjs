// Test scenarios: seeded random play plus RAM pokes that steer the game into
// paths random play rarely reaches. The same pokes go to the oracle, the
// translated machine and (as POKE lines in the input script) MAME, so all
// three must still agree. RAM used (from the program, see tools/out/main.lst):
//   $1F current player, $21 two-player game, $29/$2A lives left (-1 = out)
//   $2D-$2F player 1 score (BCD, low byte first)
//   $61,X level, $62 set once a game has started, $63 stage layout 0-5
//   $65,X pieces landed on plates this stage; the stage is clear when it
//         reaches the total for the layout at $E82D (16 16 18 32 16 18)
import { randomSessionLines } from './sessions.mjs';

const STAGE_TOTALS = [16, 16, 18, 32, 16, 18];

const parse = (lines) => {
  const map = new Map();
  for (const l of lines) {
    const m = /^(\d+)\s+(\S+)\s+(.+?)\s+(\d+)$/.exec(l);
    const f = Number(m[1]);
    if (!map.has(f)) map.set(f, []);
    map.get(f).push([m[2], m[3], Number(m[4])]);
  }
  return map;
};

// two players: two coins, then the 2 player start button
function twoPlayerLines(frames, seed) {
  return randomSessionLines(frames, seed).map((l) => l
    .replace(/^(\d+) SYSTEM 1 Player Start/, '$1 SYSTEM 2 Players Start'))
    .concat(['70 SYSTEM Coin 1 1', '74 SYSTEM Coin 1 0'])
    .sort((a, b) => Number(a.split(' ')[0]) - Number(b.split(' ')[0]));
}

// hook(ram, frame, state) -> [[addr, value], ...] pokes to apply after the frame
const HOOKS = {
  play: () => () => [],
  // start at level n: the new-game code leaves $61 = 0 for a frame before the
  // first level start increments it
  start: (n) => (ram, frame, st) => {
    if (!st.done && ram[0x62] === 1 && ram[0x61] === 0) { st.done = true; return [[0x61, n - 1]]; }
    return [];
  },
  // each stage needs only one more piece on a plate
  clear: () => (ram, frame, st) => {
    const x = ram[0x1f];
    const total = STAGE_TOTALS[ram[0x63]];
    if (ram[0x62] === 1 && ram[0x65 + x] === 0 && st.level !== `${x}:${ram[0x61 + x]}`) {
      st.level = `${x}:${ram[0x61 + x]}`;
      return [[0x65 + x, total - 1]];
    }
    return [];
  },
  // a score that makes the high score table
  hiscore: () => (ram, frame, st) => {
    if (!st.done && ram[0x62] === 1 && frame > 300) { st.done = true; return [[0x2d, 0x50], [0x2e, 0x42], [0x2f, 0x01]]; }
    return [];
  },
  // lives never run out
  lives: () => (ram) => (ram[0x62] === 1 && ram[0x29] < 0x80 && ram[0x29] < 2 ? [[0x29, 2]] : []),
};

// name: "<kind>[<arg>]-<seed>", e.g. play-3, start4-7, clear-2, hiscore-5, 2p-1, lives-9
export function scenario(name, frames) {
  const m = /^(play|start|clear|hiscore|2p|lives|attract)(\d*)(?:-(\d+))?$/.exec(name);
  if (!m) throw new Error(`unknown scenario ${name}`);
  const [, kind, arg, seedText] = m;
  const seed = Number(seedText ?? 1);
  if (kind === 'attract') return { name, inputs: new Map(), lines: [], hook: () => [] };
  const lines = kind === '2p' ? twoPlayerLines(frames, seed) : randomSessionLines(frames, seed);
  const make = kind === '2p' ? HOOKS.play : HOOKS[kind];
  const hookFn = make(Number(arg || 0));
  const state = {};
  return { name, inputs: parse(lines), lines, hook: (ram, frame) => hookFn(ram, frame, state) };
}

// run a scenario's frame-end step on a machine: pokes (now) and inputs
// (lag frames after their script frame, as MAME applies them)
export function stepScenario(machine, sc, frame, lag, applyInputs, log) {
  for (const [addr, value] of sc.hook(machine.bus.ram, frame)) {
    machine.bus.ram[addr] = value;
    if (log) log.push(`${frame} POKE ${addr} ${value}`);
  }
  applyInputs(machine, sc.inputs.get(frame - lag));
}
