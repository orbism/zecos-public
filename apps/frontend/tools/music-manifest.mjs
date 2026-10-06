// Lists public/music/*.mp3 into public/music/manifest.json, Zecamp's default
// playlist. Built rather than read at runtime: on Vercel a function cannot see
// public/, and tracing the mp3s into one would blow its size limit.
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'public', 'music');
mkdirSync(dir, { recursive: true });
const tracks = readdirSync(dir)
  .filter((f) => /\.mp3$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((file) => ({ file, url: `/music/${encodeURIComponent(file)}`, size: statSync(join(dir, file)).size }));
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ tracks }, null, 1) + '\n');
console.log(`[music] ${tracks.length} track(s) in public/music/manifest.json`);
