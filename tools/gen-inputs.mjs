// Writes a seeded random play session as an input script.
//   node tools/gen-inputs.mjs <frames> <seed> > script.txt
import { randomSessionLines } from './sessions.mjs';

console.log(randomSessionLines(Number(process.argv[2] ?? 5000), Number(process.argv[3] ?? 1)).join('\n'));
