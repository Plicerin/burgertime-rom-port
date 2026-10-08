// Records a MAME run of btime with tools/mame/dump.lua.
//   node tools/record-mame.mjs <frames> <out.bin> [inputs.txt] [snapFrames snapDir]
// Needs MAME with btime.zip in its rompath (scoop's mame here). MAME can't
// write under Documents (Controlled Folder Access), so keep out.bin in TEMP.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [frames, out, inputs, snapFrames, snapDir] = process.argv.slice(2);
const MAME_DIR = process.env.MAME_DIR ?? path.join(process.env.USERPROFILE, 'scoop', 'apps', 'mame', 'current');
const script = fileURLToPath(new URL('./mame/dump.lua', import.meta.url));
const r = spawnSync(path.join(MAME_DIR, 'mame.exe'), ['btime', '-video', 'none', '-sound', 'none', '-nothrottle', '-noplugins', '-skip_gameinfo', '-autoboot_script', script, ...(snapDir ? ['-snapshot_directory', path.resolve(snapDir), '-snapname', '%i'] : [])], {
  cwd: MAME_DIR,
  env: { ...process.env, BTIME_FRAMES: frames, BTIME_OUT: path.resolve(out), BTIME_INPUTS: inputs ? path.resolve(inputs) : '', BTIME_SNAPS: snapFrames ?? '' },
  stdio: 'inherit',
});
process.exitCode = r.status ?? 1;
