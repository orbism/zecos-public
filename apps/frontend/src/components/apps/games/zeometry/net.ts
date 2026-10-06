import { create } from 'zustand';
import { zim, zimReady, type ZimPerson } from '@/store/zimStore';
import { useWindowStore } from '@/store/windowStore';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { APP_META } from '@/config/appMeta';
import type { Input, Snapshot, Mode } from './engine';

/**
 * Online play, built on what ZEC-OS already has.
 *
 *  - Who is online: your ZIM buddy list (verified accounts only, by design),
 *    and what each one is doing; the lobby sets yours to the game.
 *  - Invites and the WebRTC handshake: ZIM messages that start with a tag.
 *    ZIM's chat renders those as a small game card instead of their payload,
 *    so a chat never fills up with connection blobs.
 *  - The game itself: a WebRTC data channel, browser to browser. The host's
 *    browser runs the world; guests send their sticks and draw what it sends.
 *
 * So nothing new runs on the server. The one cost is the usual WebRTC one:
 * two players behind strict NATs may not connect (there is no relay), and
 * the lobby says so rather than spinning.
 */

export const TAG = '⟦zw⟧';
export type Sig =
  | { t: 'invite'; room: string; mode: Exclude<Mode, 'solo'>; from: string }
  | { t: 'join'; room: string }
  | { t: 'decline'; room: string }
  /** The handshake, split into parts: ZIM caps a message at 1,000 characters. */
  | { t: 'offer'; room: string; sdp: string; i: number; n: number }
  | { t: 'answer'; room: string; sdp: string; i: number; n: number }
  | { t: 'bye'; room: string };

export const isSignal = (body: string) => body.startsWith(TAG);
export function parseSignal(body: string): Sig | null {
  if (!isSignal(body)) return null;
  try { return JSON.parse(body.slice(TAG.length)) as Sig; } catch { return null; }
}
/** What ZIM shows instead of the raw message. */
export function describeSignal(s: Sig, mine: boolean): string | null {
  if (s.t === 'invite') return mine ? `You invited them to Zeometry Wars (${s.mode === 'coop' ? 'co-op' : 'versus'})` : `Invited you to Zeometry Wars (${s.mode === 'coop' ? 'co-op' : 'versus'})`;
  if (s.t === 'join') return mine ? 'You asked to join their Zeometry Wars game' : 'Wants to join your Zeometry Wars game';
  if (s.t === 'decline') return mine ? 'You passed on Zeometry Wars' : 'Passed on Zeometry Wars. Probably scared.';
  return null; // the handshake itself is never shown
}

/** An invite someone clicked in ZIM, waiting for the game window to pick it up. */
type Pending = { peerId: string; room: string; mode: 'coop' | 'versus' };
export const useZeometryInvite = create<{ pending: Pending | null; set: (p: Pending | null) => void }>((set) => ({ pending: null, set: (pending) => set({ pending }) }));
/** Open (or raise) the game, with an invite to answer. Lives here so ZIM can call it without loading the game. */
export function openZeometry(pending?: Pending) {
  if (pending) useZeometryInvite.getState().set(pending);
  const app = APP_META.find((a) => a.id === 'zeometry')!;
  const ws = useWindowStore.getState();
  ws.openWindow({ id: app.id, type: app.id, title: app.title, size: app.defaultSize, minSize: app.minSize,
    position: calculateWindowPosition(ws.windows, app.defaultSize, window.innerWidth, window.innerHeight) });
}

export async function sendSignal(peerId: string, sig: Sig) {
  await zim(`messages/${encodeURIComponent(peerId)}`, { method: 'POST', body: { body: TAG + JSON.stringify(sig) } });
}
export const newRoom = () => Math.random().toString(36).slice(2, 8);

const PART = 760;
async function sendSdp(peerId: string, t: 'offer' | 'answer', room: string, packed: string) {
  const n = Math.ceil(packed.length / PART);
  for (let i = 0; i < n; i++) await sendSignal(peerId, { t, room, sdp: packed.slice(i * PART, (i + 1) * PART), i, n });
}
/** Puts a handshake back together as its parts arrive; resolves the whole thing once complete. */
export class Assembler {
  private parts = new Map<string, string[]>();
  add(from: string, s: Extract<Sig, { t: 'offer' | 'answer' }>): string | null {
    const key = `${from}:${s.room}:${s.t}`;
    const got = this.parts.get(key) ?? new Array<string>(s.n);
    got[s.i] = s.sdp; this.parts.set(key, got);
    if (got.filter((x) => x !== undefined).length < s.n) return null;
    this.parts.delete(key);
    return got.join('');
  }
}
/** Only what a data channel needs: no TCP candidates, no media lines' extras. */
function slim(sdp: string): string {
  return sdp.split('\r\n').filter((l) => l && !/^a=candidate:.* tcp /i.test(l) && !l.startsWith('a=extmap-allow-mixed') && !l.startsWith('a=msid-semantic')).join('\r\n') + '\r\n';
}

// ── Lobby ────────────────────────────────────────────────────────────────
export const DOING_LOBBY = 'in the Zeometry Wars lobby';
export const DOING_HOSTING = 'hosting Zeometry Wars';
export const DOING_PLAYING = 'playing Zeometry Wars';

export async function buddies(): Promise<ZimPerson[]> {
  if (!zimReady()) return [];
  const r = await zim<{ buddies: ZimPerson[] }>('buddies');
  return r.buddies;
}
export async function setDoing(doing: string | null) {
  if (!zimReady()) return;
  try { await zim('me/status', { method: 'PUT', body: { doing } }); } catch { /* cosmetic */ }
}

interface Msg { id: string; mine: boolean; body: string; at: string }
/** New game signals from one buddy since `after` (ISO). */
export async function signalsFrom(peerId: string, after: string): Promise<{ sigs: Sig[]; last: string }> {
  const t = await zim<{ messages: Msg[] }>(`messages/${encodeURIComponent(peerId)}?after=${encodeURIComponent(after)}`);
  const sigs: Sig[] = [];
  let last = after;
  for (const m of t.messages) { if (m.at > last) last = m.at; if (!m.mine) { const s = parseSignal(m.body); if (s) sigs.push(s); } }
  return { sigs, last };
}

// ── WebRTC ───────────────────────────────────────────────────────────────
const ICE: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] };

/** SDP is chatty text; deflate it so a handshake fits in one ZIM message. */
async function pack(sdp: string): Promise<string> {
  const s = new Blob([sdp]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const b = new Uint8Array(await new Response(s).arrayBuffer());
  let bin = ''; b.forEach((x) => { bin += String.fromCharCode(x); });
  return btoa(bin);
}
async function unpack(s: string): Promise<string> {
  const b = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}
/** Gather every candidate up front (no trickle): one message each way, not dozens. */
function gathered(pc: RTCPeerConnection, ms = 3000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); res(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, ms);
  });
}

export type HostMsg =
  | { k: 'hello'; you: string; mode: Mode; players: { id: string; name: string; color: string; ship: string }[] }
  | { k: 'snap'; s: Snapshot }
  | { k: 'end' };
export type GuestMsg = { k: 'in'; i: Input } | { k: 'me'; name: string; ship: string };

/** The host's side: one data channel per guest. */
export class HostLink {
  conns = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel; open: boolean }>();
  onOpen?: (peerId: string) => void;
  onClose?: (peerId: string) => void;
  onMsg?: (peerId: string, m: GuestMsg) => void;
  constructor(public room: string) {}
  async offer(peerId: string) {
    const pc = new RTCPeerConnection(ICE);
    const dc = pc.createDataChannel('zw', { ordered: false, maxRetransmits: 0 });
    const c = { pc, dc, open: false };
    this.conns.set(peerId, c);
    dc.onopen = () => { c.open = true; this.onOpen?.(peerId); };
    dc.onclose = () => { c.open = false; this.onClose?.(peerId); };
    dc.onmessage = (e) => { try { this.onMsg?.(peerId, JSON.parse(e.data as string) as GuestMsg); } catch { /* junk */ } };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    await sendSdp(peerId, 'offer', this.room, await pack(slim(pc.localDescription!.sdp)));
  }
  async answer(peerId: string, sdp: string) {
    const c = this.conns.get(peerId);
    if (c) await c.pc.setRemoteDescription({ type: 'answer', sdp: await unpack(sdp) });
  }
  send(peerId: string, m: HostMsg) { const c = this.conns.get(peerId); if (c?.open) try { c.dc.send(JSON.stringify(m)); } catch { /* full */ } }
  broadcast(m: HostMsg) { const s = JSON.stringify(m); for (const c of this.conns.values()) if (c.open) try { c.dc.send(s); } catch { /* full */ } }
  close() { for (const c of this.conns.values()) c.pc.close(); this.conns.clear(); }
}

/** A guest's side: the one channel to the host. */
export class GuestLink {
  pc: RTCPeerConnection | null = null; dc: RTCDataChannel | null = null;
  onOpen?: () => void; onClose?: () => void; onMsg?: (m: HostMsg) => void;
  constructor(public room: string, public hostId: string) {}
  async accept(sdp: string) {
    const pc = this.pc = new RTCPeerConnection(ICE);
    pc.ondatachannel = (e) => {
      const dc = this.dc = e.channel;
      dc.onopen = () => this.onOpen?.();
      dc.onclose = () => this.onClose?.();
      dc.onmessage = (ev) => { try { this.onMsg?.(JSON.parse(ev.data as string) as HostMsg); } catch { /* junk */ } };
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: await unpack(sdp) });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await sendSdp(this.hostId, 'answer', this.room, await pack(slim(pc.localDescription!.sdp)));
  }
  send(m: GuestMsg) { if (this.dc?.readyState === 'open') try { this.dc.send(JSON.stringify(m)); } catch { /* full */ } }
  close() { this.pc?.close(); }
}
