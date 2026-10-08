// ROM coverage of the main CPU translation: which bytes are executed code,
// code only the static walk found, data read in the traces, or untouched.
//   node tools/coverage.mjs [minRun]
import { readFileSync } from 'node:fs';
import { decode } from './disasm.mjs';
import { loadRoms } from './oracle.mjs';

const minRun = Number(process.argv[2] ?? 24);
const rom = loadRoms().main;
const t = JSON.parse(readFileSync(new URL('./out/trace.json', import.meta.url)));
const src = readFileSync(new URL('../src/btimeMainRecomp.mjs', import.meta.url), 'utf8');
const keys = [...src.matchAll(/case 0x([0-9a-f]{5}):/g)].map((m) => parseInt(m[1], 16));
const map = new Uint8Array(0x10000); // 0 untouched, 1 data, 2 static code, 3 executed code
for (const a of t.dataReads) map[a] = 1;
const ex = new Set(t.executed.map(([k]) => Number(k)));
for (const k of keys) {
  const d = decode(rom, k & 0xffff, k >> 16 === 1);
  for (let i = 0; i < d.size; i += 1) map[(k & 0xffff) + i] = Math.max(map[(k & 0xffff) + i], ex.has(k) ? 3 : 2);
}
const cnt = [0, 0, 0, 0];
for (let a = 0xc000; a < 0x10000; a += 1) cnt[map[a]] += 1;
console.log(`executed code ${cnt[3]}, static-only code ${cnt[2]}, data read ${cnt[1]}, untouched ${cnt[0]} bytes`);
const runs = [];
for (let a = 0xc000; a < 0x10000;) {
  if (map[a]) { a += 1; continue; }
  let b = a;
  while (b < 0x10000 && !map[b]) b += 1;
  if (b - a >= minRun) runs.push(`${a.toString(16)}+${b - a}`);
  a = b;
}
console.log(`${runs.length} untouched runs of ${minRun}+ bytes: ${runs.join(' ')}`);
