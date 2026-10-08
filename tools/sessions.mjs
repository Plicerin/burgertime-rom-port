// Seeded random play sessions as input scripts (tools/inputs.mjs format):
// coin, 1 player start, then joystick and pepper changes, with another coin
// and start now and then so long sessions keep playing.

export function randomSessionLines(frames, seedIn) {
  let seed = seedIn >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lines = [];
  const ev = (f, port, field, v) => lines.push([f, `${f} ${port} ${field} ${v}`]);
  ev(60, 'SYSTEM', 'Coin 1', 1);
  ev(64, 'SYSTEM', 'Coin 1', 0);
  ev(120, 'SYSTEM', '1 Player Start', 1);
  ev(124, 'SYSTEM', '1 Player Start', 0);

  const DIRS = ['P1 Right', 'P1 Left', 'P1 Up', 'P1 Down'];
  let held = null;
  let pepper = false;
  for (let f = 140; f < frames;) {
    // hold a direction (or nothing) for 8-90 frames; sometimes tap pepper
    const next = rand() < 0.15 ? null : DIRS[Math.floor(rand() * 4)];
    if (next !== held) {
      if (held) ev(f, 'P1', held, 0);
      if (next) ev(f, 'P1', next, 1);
      held = next;
    }
    if (pepper) { ev(f, 'P1', 'P1 Button 1', 0); pepper = false; }
    else if (rand() < 0.08) { ev(f, 'P1', 'P1 Button 1', 1); pepper = true; }
    f += 8 + Math.floor(rand() * 82);
    if (rand() < 0.01) { ev(f, 'SYSTEM', 'Coin 1', 1); ev(f + 4, 'SYSTEM', 'Coin 1', 0); ev(f + 60, 'SYSTEM', '1 Player Start', 1); ev(f + 64, 'SYSTEM', '1 Player Start', 0); f += 70; }
  }
  return lines.sort((a, b) => a[0] - b[0]).map(([, l]) => l);
}

// the same session as a Map frame -> [[port, field, value]]
export function randomSession(frames, seed) {
  const map = new Map();
  for (const l of randomSessionLines(frames, seed)) {
    const m = /^(\d+)\s+(\S+)\s+(.+?)\s+(\d+)$/.exec(l);
    const f = Number(m[1]);
    if (!map.has(f)) map.set(f, []);
    map.get(f).push([m[2], m[3], Number(m[4])]);
  }
  return map;
}
