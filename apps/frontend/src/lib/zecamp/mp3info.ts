/**
 * What zecAmp shows about a track before it plays: title and artist from the
 * ID3v2 tag, and bitrate, sample rate, channels and length from the first MPEG
 * frame (a Xing/Info header gives the exact length of a VBR file).
 *
 * Reads only the head of the file, so the playlist fills in without
 * downloading whole tracks. Anything unreadable is simply left out.
 */

export interface Mp3Info {
  title?: string;
  artist?: string;
  kbps?: number;
  khz?: number;
  stereo?: boolean;
  duration?: number;
}

export const HEAD_BYTES = 128 * 1024;

const BITRATES: Record<string, number[]> = {
  // MPEG-1 Layer III, then MPEG-2/2.5 Layer III (kbps; index 0 is "free").
  '1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

const syncsafe = (b: Uint8Array, o: number) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];

function text(b: Uint8Array): string {
  const enc = b[0];
  const body = b.subarray(1);
  const label = enc === 1 || enc === 2 ? (enc === 2 ? 'utf-16be' : 'utf-16') : enc === 3 ? 'utf-8' : 'latin1';
  try { return new TextDecoder(label).decode(body).replace(/\0+$/g, '').replace(/\0/g, ' / ').trim(); } catch { return ''; }
}

export function parseMp3(buf: ArrayBuffer, fileSize?: number): Mp3Info {
  const b = new Uint8Array(buf);
  const info: Mp3Info = {};
  let pos = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {      // "ID3"
    const ver = b[3];
    const end = 10 + syncsafe(b, 6);
    let o = 10;
    while (o + 10 <= Math.min(end, b.length)) {
      const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = ver >= 4 ? syncsafe(b, o + 4) : (b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7];
      if (size <= 0 || o + 10 + size > b.length) break;
      const body = b.subarray(o + 10, o + 10 + size);
      if (id === 'TIT2') info.title = text(body) || undefined;
      else if (id === 'TPE1') info.artist = text(body) || undefined;
      else if (id === 'TLEN') { const ms = Number(text(body)); if (ms > 0) info.duration = ms / 1000; }
      o += 10 + size;
    }
    pos = end;
  }
  // First frame header.
  for (let i = pos; i < b.length - 4; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (b[i + 1] >> 3) & 3;                         // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const layer = (b[i + 1] >> 1) & 3;                           // 1 = Layer III
    const brIdx = b[i + 2] >> 4, srIdx = (b[i + 2] >> 2) & 3;
    if (verBits === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const mono = (b[i + 3] >> 6) === 3;
    const mpeg1 = verBits === 3;
    info.kbps = BITRATES[mpeg1 ? '1' : '2'][brIdx];
    const rate = RATES[verBits][srIdx];
    info.khz = Math.round(rate / 1000);
    info.stereo = !mono;
    // Xing/Info: frame count, so the exact length of a VBR file.
    const x = i + 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17));
    const tag = String.fromCharCode(b[x], b[x + 1], b[x + 2], b[x + 3]);
    if ((tag === 'Xing' || tag === 'Info') && (b[x + 7] & 1)) {
      const frames = (b[x + 8] << 24) | (b[x + 9] << 16) | (b[x + 10] << 8) | b[x + 11];
      if (frames > 0) info.duration ??= (frames * (mpeg1 ? 1152 : 576)) / rate;
    } else if (fileSize && info.kbps) {
      info.duration ??= ((fileSize - i) * 8) / (info.kbps * 1000);   // CBR estimate
    }
    break;
  }
  return info;
}
