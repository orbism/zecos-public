#!/usr/bin/env node
/**
 * The ZEC-OS mark, everywhere it is needed, from one 16×16 pixel map.
 *
 *   node tools/brand.mjs
 *
 * Two tiles, same Z (the Zcash Z: a stepped diagonal and the two stroke nubs):
 *   Gold Tile  - bevelled gold square, ink Z. The main mark.
 *   Night Tile - dark square in a gold bevel frame, gold Z. For light themes
 *                and anywhere the mark sits on its own (home-screen icons).
 *
 * Writes:
 *   public/brand/zec-tile-{gold,night}.svg and -{32,180,512}.png
 *   public/zec-logo.svg            (= gold; what every <img> in the app uses)
 *   public/apple-touch-icon.png    (night, full-bleed 180)
 *   public/icon-512.png            (night, 512)
 *   src/app/favicon.ico            (gold, 16/32/48)
 *   src/config/brandMark.ts        (the pixel rows, for the OG cards)
 *
 * No dependencies: PNG and ICO are written by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = { k: '#16110c', y: '#f4b728', h: '#ffe08a', s: '#c8921c', x: '#8a6414', v: '#0e1615' };
const Z = ['', '', '', '.......##', '....########', '.........###', '........###', '.......###', '......###', '.....###', '....###', '....########', '.......##'];
const isZ = (x, y) => Z[y]?.[x] === '#';

/** 16 rows of palette letters; '.' is transparent (the clipped corners). */
function tile(kind) {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      if ((x === 0 || x === 15) && (y === 0 || y === 15)) { row += '.'; continue; }
      const edge = x === 0 || x === 15 || y === 0 || y === 15 || ((x === 1 || x === 14) && (y === 1 || y === 14));
      const inner = !edge && x > 1 && y > 1 && x < 14 && y < 14;
      let c;
      if (kind === 'night') {
        c = edge ? 'k' : (x === 1 || y === 1) ? 'h' : (x === 14 || y === 14) ? 'x' : (x === 2 || y === 2 || x === 13 || y === 13) ? 's' : 'v';
        if (isZ(x, y)) c = 'y'; else if (isZ(x - 1, y - 1) && inner && x > 2 && y > 2 && x < 13 && y < 13) c = 'x';
      } else {
        c = edge ? 'k' : (x === 1 || y === 1) ? 'h' : (x === 14 || y === 14) ? 'x' : (x === 13 || y === 13) ? 's' : 'y';
        if (isZ(x, y)) c = 'k'; else if (isZ(x - 1, y - 1) && inner) c = 'x';
      }
      row += c;
    }
    rows.push(row);
  }
  return rows;
}

const svg = (rows, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
  <title>${title}</title>
${rows.map((r, y) => [...r].map((c, x) => c === '.' ? '' : `  <rect x="${x}" y="${y}" width="1" height="1" fill="${P[c]}"/>`).filter(Boolean).join('\n')).join('\n')}
</svg>
`;

// ---- PNG, by hand --------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Nearest-neighbour scale of the 16×16 rows to size×size; `fill` paints the transparent corners. */
function png(rows, size, fill) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = rows[Math.floor((y * 16) / size)][Math.floor((x * 16) / size)];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (c === '.' && !fill) continue;
      const [r, g, b] = hex(c === '.' ? fill : P[c]);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** ICO holding PNG images (fine everywhere since Vista). */
function ico(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let off = 6 + 16 * images.length;
  const dir = images.map(([size, data]) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(off, 12); off += data.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...images.map(([, d]) => d)]);
}

// ---- write -----------------------------------------------------------------
const gold = tile('gold'), night = tile('night');
const out = (p, data) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), data); console.log('wrote', p); };

out('public/brand/zec-tile-gold.svg', svg(gold, 'ZEC-OS'));
out('public/brand/zec-tile-night.svg', svg(night, 'ZEC-OS'));
out('public/zec-logo.svg', svg(gold, 'ZEC-OS'));
for (const [name, rows] of [['gold', gold], ['night', night]]) for (const s of [32, 180, 512]) out(`public/brand/zec-tile-${name}-${s}.png`, png(rows, s));
out('public/apple-touch-icon.png', png(night, 180, P.k));
out('public/icon-512.png', png(night, 512));
out('src/app/favicon.ico', ico([[16, png(gold, 16)], [32, png(gold, 32)], [48, png(gold, 48)]]));
out('src/config/brandMark.ts', `/**
 * The ZEC-OS mark as pixel rows - generated by tools/brand.mjs, do not edit.
 *
 * Gold Tile is the main mark; Night Tile is its dark twin (light themes,
 * home-screen icons). '.' is transparent: the tile's clipped corners.
 */
export const BRAND_PALETTE: Record<string, string> = ${JSON.stringify(P)};

export const ZEC_TILE_GOLD: string[] = ${JSON.stringify(gold, null, 2)};

export const ZEC_TILE_NIGHT: string[] = ${JSON.stringify(night, null, 2)};
`);
