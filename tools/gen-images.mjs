// Renders the site's images from the translated game (src/), no ROM needed:
// the poster, screens, cast plates and icons in img/.
//   node tools/gen-images.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { BtimeMachine } from '../src/btimeMachine.mjs';
import { decodeGfx, renderFrame, toScreenRGBA, paletteRGB } from '../src/btimeVideo.mjs';
import { GFX1, GFX2, BG_MAP } from '../src/btimeGfxData.mjs';
import { encodePNG } from './png.mjs';
import { applyInputs } from './inputs.mjs';
import { scenario, stepScenario } from './scenarios.mjs';

const OUT = new URL('../img/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const gfx = decodeGfx(GFX1, GFX2);
const screen = (m) => toScreenRGBA(renderFrame(m.bus, gfx, BG_MAP), m.bus.palette);

// scale a 240x240 screen to the monitor's 3:4 (3x wide, 4x tall), or crop
function scaled(rgba, w, h, sx, sy, x0 = 0, y0 = 0, cw = w, ch = h) {
  const out = new Uint8ClampedArray(cw * sx * ch * sy * 4);
  for (let y = 0; y < ch * sy; y += 1) {
    for (let x = 0; x < cw * sx; x += 1) {
      const s = ((y0 + Math.floor(y / sy)) * w + x0 + Math.floor(x / sx)) * 4;
      const d = (y * cw * sx + x) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = 255;
    }
  }
  return { rgba: out, w: cw * sx, h: ch * sy };
}
const save = (name, { rgba, w, h }) => writeFileSync(new URL(name, OUT), encodePNG(w, h, rgba, 1));
const full = (rgba) => scaled(rgba, 240, 240, 3, 4);

// attract mode
// one sprite from sprite RAM on black, turned as the monitor shows it: screen
// pixel (u, v) of the tile is board pixel (15 - v, u) of the sprite
function spriteAlone(m, index) {
  const v = m.bus.vram, o = index * 0x80;
  const code = v[o + 0x20], flipx = v[o] & 0x04, flipy = v[o] & 0x02;
  const rgba = new Uint8ClampedArray(16 * 16 * 4);
  for (let sv = 0; sv < 16; sv += 1) {
    for (let su = 0; su < 16; su += 1) {
      let tx = 15 - sv, ty = su;
      if (flipx) tx = 15 - tx;
      if (flipy) ty = 15 - ty;
      const pen = gfx.sprites[code * 256 + ty * 16 + tx];
      const [r, g, b] = pen ? paletteRGB(m.bus.palette[pen]) : [0, 0, 0];
      const d = (sv * 16 + su) * 4;
      rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = 255;
    }
  }
  return rgba;
}

const shots = {};
const sprites = {};
const m = new BtimeMachine();
for (let f = 0; f <= 1800; f += 1) {
  m.runFrame();
  if ([150, 300, 750, 1800].includes(f)) shots[f] = screen(m);
  // the character introduction: hot dog, pickle, egg and Peter Pepper
  if (f === 750) for (const i of [0, 1, 2, 7]) sprites[i] = spriteAlone(m, i);
}
save('start.png', full(shots[750]));
save('scores.png', full(shots[300]));
save('demo.png', full(shots[1800]));
// cast: sprites at frame 750 (screen x, y of each 16x16 sprite) and the
// bonus items on the score table (characters)
const plate = (rgba, x, y, w, h) => scaled(rgba, 240, 240, 3, 4, x, y, w, h);
const sprite = (i) => scaled(sprites[i], 16, 16, 3, 4);
save('sprite_peter.png', sprite(7));
save('sprite_hotdog.png', sprite(0));
save('sprite_pickle.png', sprite(1));
save('sprite_egg.png', sprite(2));
save('items.png', plate(shots[300], 24, 104, 96, 32));

// a later stage (level 4: the eight-burger layout) and the high score entry
function play(name, frames, pick) {
  const sc = scenario(name, frames);
  const g = new BtimeMachine();
  for (let f = 0; f < frames; f += 1) {
    g.runFrame();
    if (pick(g, f)) return screen(g);
    stepScenario(g, sc, f, 0, applyInputs);
  }
  throw new Error(`${name}: no frame picked`);
}
save('stage4.png', full(play('start4-4', 20000, (g, f) => g.bus.ram[0x63] === 3 && g.bus.ram[0x1b] && f > 900)));
// in scenario hiscore-1 the name entry routine ($F42F) first runs in frame
// 2430 (found with the oracle's instruction hook)
save('initials.png', full(play('hiscore-1', 3000, (g, f) => f === 2430 + 240)));

// icons: the chef on black
for (const size of [180, 192, 512]) {
  const p = sprite(7);
  const img = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) img[i * 4 + 3] = 255;
  const sx = 3 * 16, sy = 4 * 16; // plate is 48 x 64
  const k = Math.min(size / sx, size / sy) * 0.8;
  const ox = Math.floor((size - sx * k) / 2), oy = Math.floor((size - sy * k) / 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = Math.floor((x - ox) / k), py = Math.floor((y - oy) / k);
      if (px < 0 || py < 0 || px >= sx || py >= sy) continue;
      const src = (py * sx + px) * 4, d = (y * size + x) * 4;
      img[d] = p.rgba[src]; img[d + 1] = p.rgba[src + 1]; img[d + 2] = p.rgba[src + 2];
    }
  }
  save(`icon-${size}.png`, { rgba: img, w: size, h: size });
}
console.log('img/ written');
