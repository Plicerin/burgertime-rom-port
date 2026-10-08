// Burger Time video (MAME screen_update_btime), rendered into a 256x256 pen
// buffer in the board's own (unrotated) coordinates; the monitor shows
// x 8-247, y 8-247, rotated 270 degrees.
//
// gfx1 ($6000 bytes, 3 bit planes of $2000): 1024 8x8 characters and, read as
// 16x16 tiles, 256 sprites. gfx2 ($1800, 3 planes of $800): 64 16x16
// background tiles, drawn with pens 8-15. bgMap: 8 pages of 16x16 tile codes.

export function decodeGfx(gfx1, gfx2) {
  const chars = new Uint8Array(1024 * 64);
  for (let code = 0; code < 1024; code += 1) {
    for (let y = 0; y < 8; y += 1) {
      const o = code * 8 + y;
      const p0 = gfx1[o], p1 = gfx1[0x2000 + o], p2 = gfx1[0x4000 + o];
      for (let x = 0; x < 8; x += 1) {
        const bit = 7 - x;
        chars[code * 64 + y * 8 + x] = ((p2 >> bit) & 1) << 2 | ((p1 >> bit) & 1) << 1 | ((p0 >> bit) & 1);
      }
    }
  }
  return { chars, sprites: decode16(gfx1, 256, 0x2000), tiles: decode16(gfx2, 64, 0x800) };
}

// MAME tile16layout: x 0-7 from bytes 16-31, x 8-15 from bytes 0-15, row = byte
function decode16(rom, count, plane) {
  const out = new Uint8Array(count * 256);
  for (let code = 0; code < count; code += 1) {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const o = code * 32 + (x < 8 ? 16 + y : y);
        const bit = 7 - (x & 7);
        out[code * 256 + y * 16 + x] = ((rom[2 * plane + o] >> bit) & 1) << 2 | ((rom[plane + o] >> bit) & 1) << 1 | ((rom[o] >> bit) & 1);
      }
    }
  }
  return out;
}

// draw a w x w tile at (sx, sy), clipped to the 256x256 buffer
function blit(out, src, base, w, sx, sy, flipx, flipy, color, transparent) {
  for (let y = 0; y < w; y += 1) {
    const py = sy + y;
    if (py < 0 || py > 255) continue;
    const ty = flipy ? w - 1 - y : y;
    for (let x = 0; x < w; x += 1) {
      const px = sx + x;
      if (px < 0 || px > 255) continue;
      const v = src[base + ty * w + (flipx ? w - 1 - x : x)];
      if (transparent && v === 0) continue;
      out[py * 256 + px] = color + v;
    }
  }
}

export function renderFrame(bus, gfx, bgMap, out = new Uint8Array(256 * 256)) {
  const flip = bus.flip;
  const bg = bus.bgControl;
  if (bg & 0x10) {
    // background: four pages in a row, page i = (start + i) & 3 | map bank,
    // shifted left by (bg & 3) pages; only the page at scroll 0 is visible
    const tmap = [];
    let start = flip ? 0 : 1;
    for (let i = 0; i < 4; i += 1) { tmap.push(start | (bg & 0x04)); start = (start + 1) & 3; }
    let scroll = -((bg & 0x03) << 8);
    for (let i = 0; i < 5; i += 1, scroll += 256) {
      if (scroll > 256) break;
      if (scroll < -256) continue;
      const page = tmap[i & 3] * 0x100;
      for (let offs = 0; offs < 0x100; offs += 1) {
        let x = 240 - (16 * (offs >> 4) + scroll) - 1;
        let y = 16 * (offs & 15);
        if (flip) { x = 240 - x; y = 240 - y; }
        blit(out, gfx.tiles, bgMap[page + offs] * 256, 16, x, y, flip, flip, 8, false);
      }
    }
  }
  // characters: RAM offset o is column 31 - o/32, row o%32
  for (let offs = 0; offs < 0x400; offs += 1) {
    let x = 31 - (offs >> 5);
    let y = offs & 31;
    const code = bus.vram[offs] + 256 * (bus.cram[offs] & 3);
    if (flip) { x = 31 - x; y = 31 - y; }
    blit(out, gfx.chars, code * 64, 8, 8 * x, 8 * y, flip, flip, 0, (bg & 0x10) !== 0);
  }
  // sprites: 8 of them in video RAM row 0, interleaved by 32 bytes
  for (let i = 0, offs = 0; i < 8; i += 1, offs += 0x80) {
    const attr = bus.vram[offs];
    if (!(attr & 0x01)) continue;
    let x = 240 - bus.vram[offs + 0x60];
    let y = 240 - bus.vram[offs + 0x40];
    let flipx = (attr & 0x04) !== 0;
    let flipy = (attr & 0x02) !== 0;
    if (flip) { x = 240 - x; y = 240 - y; flipx = !flipx; flipy = !flipy; }
    y -= 1;
    const code = bus.vram[offs + 0x20];
    blit(out, gfx.sprites, code * 256, 16, x, y, flipx, flipy, 0, true);
    blit(out, gfx.sprites, code * 256, 16, x, y + (flip ? -256 : 256), flipx, flipy, 0, true);
  }
  return out;
}

// palette RAM byte -> RGB (MAME BGR_233_inverted)
export function paletteRGB(value) {
  const v = ~value & 0xff;
  const r3 = v & 7, g3 = (v >> 3) & 7, b2 = v >> 6;
  const p3 = (n) => (n << 5) | (n << 2) | (n >> 1);
  return [p3(r3), p3(g3), b2 * 0x55];
}

// visible area (x 8-247, y 8-247) rotated 270 degrees, as RGBA: screen pixel
// (sx, sy) shows board pixel (247 - sy, 8 + sx)
export function toScreenRGBA(pens, palette, rgba = new Uint8ClampedArray(240 * 240 * 4)) {
  const lut = [];
  for (let i = 0; i < 16; i += 1) lut.push(paletteRGB(palette[i]));
  for (let sy = 0; sy < 240; sy += 1) {
    for (let sx = 0; sx < 240; sx += 1) {
      const [r, g, b] = lut[pens[(8 + sx) * 256 + (247 - sy)]];
      const o = (sy * 240 + sx) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
  return rgba;
}
