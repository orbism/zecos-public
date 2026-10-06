#!/usr/bin/env node
/**
 * The ZEC-OS social card -> public/og-image.png (1200×630).
 *
 *   node tools/og-card.mjs
 *
 * The Gold Tile (public/brand, from tools/brand.mjs), the wordmark in the
 * pixel face, and Kaze (public/kaze, from sprites.mjs --kaze) in the wind.
 * Drawn as HTML in headless Chromium, so the fonts are the app's own.
 * Needs: playwright.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execFileSync('npm', ['root', '-g']).toString().trim() + '/playwright'); }

const gusts = Array.from({ length: 7 }, (_, i) => {
  const x = 640 + ((i * 97) % 480), y = 90 + ((i * 163) % 460), len = 70 + (i % 3) * 30;
  let d = `M${x} ${y}`;
  for (let j = 1; j <= 12; j++) d += ` L${x - (len * j) / 12} ${y + Math.sin(j / 2.2 + i) * 5}`;
  const tx = x - len, ty = y + Math.sin(12 / 2.2 + i) * 5;
  for (let j = 1; j <= 8; j++) { const a = (j / 8) * Math.PI * 1.6; d += ` L${tx - Math.sin(a) * 10} ${ty - 10 + Math.cos(a) * 10}`; }
  return `<path d="${d}" fill="none" stroke="${i % 3 ? '#79bfb4' : '#c3d3cc'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${0.35 + (i % 3) * 0.15}"/>`;
}).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Pix;src:url(/fonts/PressStart2P.ttf)}
@font-face{font-family:Hand;src:url(/fonts/GochiHand.ttf)}
@font-face{font-family:Read;src:url(/fonts/AtkinsonHyperlegible-Regular.ttf)}
html,body{margin:0}
.card{position:relative;width:1200px;height:630px;overflow:hidden;background:#0e1615;
  background-image:radial-gradient(circle at 860px 330px, rgba(121,191,180,.16), rgba(121,191,180,0) 420px),
  radial-gradient(circle at 180px 120px, rgba(244,183,40,.10), rgba(244,183,40,0) 360px)}
.lock{position:absolute;left:84px;top:150px;display:flex;align-items:center;gap:34px}
.tile{width:176px;height:176px;image-rendering:pixelated}
.word{font:84px Pix;color:#f4b728;text-shadow:7px 7px 0 #d98b6e,-4px -4px 0 #16110c,4px -4px 0 #16110c,-4px 4px 0 #16110c,4px 4px 0 #16110c}
.tag{position:absolute;left:88px;top:386px;font:40px Hand;color:#c3d3cc}
.sub{position:absolute;left:90px;top:452px;font:26px Read;color:#7d9089}
.url{position:absolute;left:90px;bottom:54px;font:22px Pix;color:#e3bb6a;letter-spacing:1px}
.kaze{position:absolute;right:80px;bottom:46px;width:256px;height:312px;image-rendering:pixelated}
svg{position:absolute;inset:0}
</style></head><body><div class="card">
<svg width="1200" height="630">${gusts}</svg>
<div class="lock"><img class="tile" src="/brand/zec-tile-gold.svg"><div class="word">ZEC-OS</div></div>
<div class="tag">Explore. Analyze. Learn. Play.</div>
<div class="sub">A retro desktop of tools and apps for the Zcash network.</div>
<div class="url">zec-os.com</div>
<img class="kaze" src="/kaze/kaze-wave-8x.png" onerror="this.src='/kaze/kaze-8x.png'">
</div></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
  const f = path.join(root, 'public', decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  const type = f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'font/ttf';
  res.writeHead(200, { 'content-type': type }); res.end(fs.readFileSync(f));
}).listen(0);
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto(`http://localhost:${server.address().port}/`);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(300);
await p.locator('.card').screenshot({ path: path.join(root, 'public/og-image.png') });
await b.close(); server.close();
console.log('wrote public/og-image.png');
