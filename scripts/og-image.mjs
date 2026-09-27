/**
 * Generates `public/og.png` (1200×630 Open Graph image) with zero image
 * dependencies: raw RGBA pixels → zlib (fflate) → PNG, text drawn from a
 * 5×7 bitmap font. Deterministic output; commit the result and re-run
 * `pnpm og` only when the branding changes.
 */

import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1200;
const H = 630;

/* ---------- tiny helpers -------------------------------------- */

const px = new Uint8Array(W * H * 4); // RGBA, opaque

function put(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = 255;
}

function fillRect(x, y, w, h, [r, g, b]) {
  for (let yy = 0; yy < h; yy += 1) for (let xx = 0; xx < w; xx += 1) put(x + xx, y + yy, r, g, b);
}

function roundedRect(x, y, w, h, rad, color, thickness = 1) {
  for (let yy = 0; yy < h; yy += 1) {
    for (let xx = 0; xx < w; xx += 1) {
      const dx = Math.max(0, Math.abs(xx - (w - 1) / 2) - (w / 2 - rad - 0.5));
      const dy = Math.max(0, Math.abs(yy - (h - 1) / 2) - (h / 2 - rad - 0.5));
      const d = Math.hypot(dx, dy) - rad + 0.5;
      if (d >= -thickness && d <= thickness) put(x + xx, y + yy, ...color);
    }
  }
}

/** Filled vertical line (tuning-fork prong). */
function vline(x, y, h, w, [r, g, b]) {
  fillRect(x, y, w, h, [r, g, b]);
}

/* ---------- 5×7 bitmap font ------------------------------------ */
// Rows top→bottom, 5 bits each (0x10 = leftmost pixel).
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x0e, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0, 0x06],
  1: [0x04, 0x06, 0x04, 0x04, 0x04, 0x04, 0x0e],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  F: [0x1f, 0x10, 0x10, 0x1c, 0x10, 0x10, 0x10],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  a: [0, 0, 0x0e, 0x01, 0x0f, 0x11, 0x0f],
  b: [0x10, 0x10, 0x1e, 0x11, 0x11, 0x11, 0x1e],
  e: [0, 0, 0x0e, 0x11, 0x1f, 0x10, 0x0e],
  g: [0, 0, 0x0e, 0x11, 0x0f, 0x01, 0x0e],
  h: [0x04, 0x04, 0x04, 0x0e, 0x11, 0x11, 0x11],
  i: [0x04, 0, 0x0c, 0x04, 0x04, 0x04, 0x0e],
  l: [0x0c, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  n: [0, 0, 0x1b, 0x15, 0x15, 0x15, 0x15],
  o: [0, 0, 0x0e, 0x11, 0x11, 0x11, 0x0e],
  r: [0, 0, 0x16, 0x19, 0x10, 0x10, 0x10],
  s: [0, 0, 0x0f, 0x10, 0x0e, 0x01, 0x1e],
  t: [0x04, 0x04, 0x0e, 0x04, 0x04, 0x05, 0x0c],
  u: [0, 0, 0x11, 0x11, 0x11, 0x13, 0x0e],
  v: [0, 0, 0x11, 0x11, 0x11, 0x0a, 0x04],
  w: [0, 0, 0x11, 0x15, 0x15, 0x11, 0x0a],
  y: [0, 0, 0x11, 0x11, 0x0e, 0x01, 0x0e],
};

/** Draw `text` at (x, y) with pixel `scale`, in `color`. */
function drawText(x, y, text, scale, color) {
  let cursor = x;
  for (const char of text) {
    const glyph = FONT[char] ?? FONT[' '];
    for (let row = 0; row < 7; row += 1) {
      const bits = glyph[row] ?? 0;
      for (let col = 0; col < 5; col += 1) {
        if (bits & (0x10 >> col)) {
          fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursor += 6 * scale; // 5px glyph + 1px spacing
  }
}

function textWidth(text, scale) {
  return text.length * 6 * scale - scale;
}

/* ---------- compose --------------------------------------------- */

const BG = [16, 17, 20]; // #101114
const INK = [237, 237, 234]; // #EDEDEA
const ACCENT = [255, 107, 69]; // #FF6B45
const MUTED = [163, 165, 171]; // #A3A5AB

// Background
fillRect(0, 0, W, H, BG);

// Logo mark: a tuning fork inside a rounded accent square.
const logoW = 190;
const logoH = 190;
const logoX = Math.round((W - logoW) / 2);
const logoY = 78;
roundedRect(logoX, logoY, logoW, logoH, 30, ACCENT, 10);
// fork prongs (two verticals joined by a U)
const prongW = 14;
const prongH = 58;
const prongGap = 64;
const prongX = Math.round(W / 2 - prongGap / 2 - prongW / 2);
const prongY = logoY + 44;
vline(prongX, prongY, prongH, prongW, INK);
vline(prongX + prongGap, prongY, prongH, prongW, INK);
// U bend (half-ring) under the prongs
const bendCy = prongY + prongH;
const bendR = prongGap / 2;
for (let dy = 0; dy <= bendR; dy += 1) {
  const dx = Math.round(Math.sqrt(Math.max(0, bendR * bendR - dy * dy)));
  fillRect(Math.round(W / 2 - dx) - 7, bendCy + dy, 14, 14, INK);
  fillRect(Math.round(W / 2 + dx) - 7, bendCy + dy, 14, 14, INK);
}
// stem
vline(Math.round(W / 2) - 7, bendCy + bendR + 6, 44, 14, INK);

// Title
const title = 'ToolsBoogie';
const titleScale = 9;
const titleW = textWidth(title, titleScale);
drawText(Math.round((W - titleW) / 2), 330, title, titleScale, INK);

// Tagline
const tagline = 'Tools that boogie - in your browser';
const tagScale = 5;
const tagW = textWidth(tagline, tagScale);
drawText(Math.round((W - tagW) / 2), 448, tagline, tagScale, MUTED);

// Underline flourish
fillRect(Math.round(W / 2 - 60), 504, 120, 6, ACCENT);

/* ---------- PNG encode ------------------------------------------- */

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Raw scanlines with filter byte 0 per row.
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y += 1) {
  raw[y * (1 + W * 4)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
// 10..12: compression/filter/interlace = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(process.cwd(), 'public', 'og.png');
mkdirSync(join(process.cwd(), 'public'), { recursive: true });
writeFileSync(out, png);
console.log(`[og] wrote ${out} (${(png.length / 1024).toFixed(1)} KB)`);
