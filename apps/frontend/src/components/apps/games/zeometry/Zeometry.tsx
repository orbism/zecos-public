'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useWindowStore } from '@/store/windowStore';
import { openZecamp, ZECAMP_APP } from '@/lib/zecamp/engine';
import { zimReady, type ZimPerson } from '@/store/zimStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { UserBadges } from '@/components/ui/UserBadges';
import { World, W, H, NO_INPUT, DEATH_LINES, type Input, type Mode, type Snapshot, type GameEvent } from './engine';
import { Grid, Fx, drawFrame, react, spectrum, type Who } from './render';
import { SHIPS, randomShip, shipById, PLAYER_COLORS, type ShipDesign } from './ships';
import { sound } from './audio';
import { Listener, VIBE_KEY, VIBE_MODES, type VibeMode } from './vibe';
import { loadBoard, submitRun, type Row, type Period } from './board';
import { HostLink, GuestLink, Assembler, useZeometryInvite, sendSignal, signalsFrom, buddies, setDoing, newRoom, DOING_HOSTING, DOING_LOBBY, DOING_PLAYING, type HostMsg, type GuestMsg } from './net';

/**
 * ZEOMETRY WARS - Geometry Wars, for ZEC-OS. Shoot the surveillance, shield
 * the notes. Solo, or online co-op and versus with verified ZIM buddies.
 */


type Screen = 'phone' | 'menu' | 'lobby' | 'reveal' | 'playing' | 'over';
interface Hud { score: number; mult: number; wave: number; lives: number; bombs: number; height: number; others: { name: string; color: string; score: number; out: boolean }[] }
interface Over { title: string; line: string; score: number; wave: number; rank: number | null; best: boolean; winner?: string; note?: string | null }

const GOLD = '#f4b728', CYAN = '#7df9ff', PINK = '#ff4fd8';
const ORB = "var(--font-orbitron), ui-monospace, monospace";
const HUD_FONT = "ui-monospace, 'JetBrains Mono', monospace";
const btn = (on = false): React.CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'left', font: `700 17px ${ORB}`, letterSpacing: '.06em', padding: '13px 18px', borderRadius: 10, marginBottom: 10, cursor: 'pointer',
  border: `1.5px solid ${on ? GOLD : GOLD + '66'}`, color: on ? '#120e02' : '#ffe08a', background: on ? GOLD : GOLD + '12', boxShadow: on ? `0 0 22px ${GOLD}88` : 'none',
});
const panel: React.CSSProperties = { background: 'rgba(8,10,18,.86)', border: `1px solid ${GOLD}55`, borderRadius: 14, boxShadow: `0 0 40px ${GOLD}22`, padding: '20px 22px', color: '#eee' };
const small: React.CSSProperties = { font: `500 12px ${HUD_FONT}`, color: '#9aa', letterSpacing: '.04em' };

const WAVE_QUIPS = ['New block. New problems.', 'The mempool is restless.', 'Someone reused an address again.', 'Analysts have entered the chat.', 'Your privacy set is growing. So are they.', 'Halving incoming. Not the good kind.'];
const MULT_CALLS: Record<number, string> = { 10: 'TRIPLE STREAM', 25: 'QUAD STREAM', 50: 'FULLY SHIELDED', 100: 'MAXIMUM PRIVACY' };

export default function Zeometry({ windowId }: { windowId?: string }) {
  void windowId;
  const mobile = useIsMobile();
  const { displayName, isVerified, isGuest, sessionToken } = useAuthStore();
  const verified = Boolean(sessionToken && isVerified && !isGuest);
  const me = displayName ?? 'you';

  const [screen, setScreen] = useState<Screen>('menu');
  // phones: a fair warning, once, then play anyway if they insist
  const warned = useRef(false);
  useEffect(() => {
    const touchy = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) < 820;
    if ((mobile || touchy) && !warned.current) { warned.current = true; setScreen((cur) => (cur === 'menu' ? 'phone' : cur)); }
  }, [mobile]);
  const [mode, setMode] = useState<Mode>('solo');
  const [ship, setShip] = useState<ShipDesign>(() => randomShip());
  const [hud, setHud] = useState<Hud | null>(null);
  const [banner, setBanner] = useState<{ big: string; small: string } | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [paused, setPaused] = useState(false);
  // Music reactivity (zecAmp): off, groove or trip. Remembered.
  const [vibe, setVibe] = useState<VibeMode>(() => { try { const v = localStorage.getItem(VIBE_KEY) as VibeMode; return VIBE_MODES.includes(v) ? v : 'off'; } catch { return 'off'; } });
  const [vibeSilent, setVibeSilent] = useState(false);
  const vibeRef = useRef(vibe), specRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => { vibeRef.current = vibe; try { localStorage.setItem(VIBE_KEY, vibe); } catch { /* private mode */ } }, [vibe]);
  const cycleVibe = useCallback(() => {
    // On a standalone page there is no desktop to find zecAmp on: turning music on brings it up.
    if (vibeRef.current === 'off' && window.location.pathname !== '/' && !useWindowStore.getState().windows.some((w) => w.type === ZECAMP_APP)) openZecamp();
    setVibe((v) => VIBE_MODES[(VIBE_MODES.indexOf(v) + 1) % VIBE_MODES.length]!);
  }, []);
  const [board, setBoard] = useState<{ rows: Row[]; global: boolean } | null>(null);
  const [tab, setTab] = useState<{ mode: Mode; period: Period }>({ mode: 'solo', period: 'week' });

  // lobby
  const [people, setPeople] = useState<ZimPerson[]>([]);
  const [lobbyNote, setLobbyNote] = useState('');
  const [guests, setGuests] = useState<{ id: string; name: string; state: 'invited' | 'connecting' | 'ready' }[]>([]);
  const [invites, setInvites] = useState<{ peerId: string; name: string; room: string; mode: 'coop' | 'versus' }[]>([]);
  const role = useRef<{ kind: 'host'; link: HostLink } | { kind: 'guest'; link: GuestLink } | null>(null);
  const since = useRef<Record<string, string>>({});
  const assembler = useRef(new Assembler());

  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const loop = useRef<{ stop: () => void } | null>(null);
  const keys = useRef(new Set<string>());
  const mouse = useRef({ x: W / 2, y: H / 2, down: false, right: false });
  const view = useRef({ k: 1, ox: 0, oy: 0 });

  // ── Board ───────────────────────────────────────────────────────────────
  const refreshBoard = useCallback(async (m: Mode, p: Period) => { setBoard(await loadBoard(m, p)); }, []);
  useEffect(() => { void refreshBoard(tab.mode, tab.period); }, [tab, refreshBoard]);

  // ── Input ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'playing') return;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (k === 'escape' && mode === 'solo') setPaused((p) => !p);
      if (k === 'v' && !e.repeat) cycleVibe();
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => { keys.current.clear(); mouse.current.down = false; if (mode === 'solo') setPaused(true); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [screen, mode, cycleVibe]);

  /** This player's sticks, from keyboard, mouse or gamepad. `from` is the ship, for aiming at the pointer. */
  const readInput = useCallback((from: { x: number; y: number } | null): Input => {
    const k = keys.current, m = mouse.current;
    let mx = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0), my = (k.has('s') ? 1 : 0) - (k.has('w') ? 1 : 0);
    let ax = 0, ay = 0, fire = m.down, bomb = k.has(' ') || m.right;
    const kx = (k.has('arrowright') ? 1 : 0) - (k.has('arrowleft') ? 1 : 0), ky = (k.has('arrowdown') ? 1 : 0) - (k.has('arrowup') ? 1 : 0);
    if (kx || ky) { ax = kx; ay = ky; fire = true; }
    else if (from) { ax = m.x - from.x; ay = m.y - from.y; }
    const pad = typeof navigator !== 'undefined' ? navigator.getGamepads?.()[0] : null;
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
      if (dz(pad.axes[0]!) || dz(pad.axes[1]!)) { mx = dz(pad.axes[0]!); my = dz(pad.axes[1]!); }
      const rx = dz(pad.axes[2] ?? 0), ry = dz(pad.axes[3] ?? 0);
      if (rx || ry) { ax = rx; ay = ry; fire = true; }
      if (pad.buttons[5]?.pressed || pad.buttons[7]?.pressed) bomb = true;
    }
    return { mx, my, ax, ay, fire, bomb };
  }, []);

  const toArena = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect(), v = view.current, dpr = window.devicePixelRatio || 1;
    return { x: ((e.clientX - r.left) * dpr - v.ox) / v.k, y: ((e.clientY - r.top) * dpr - v.oy) / v.k };
  };

  // ── The loop ────────────────────────────────────────────────────────────
  const finish = useCallback(async (snap: Snapshot, world: World | null, myId: string, who: Record<string, Who>) => {
    loop.current?.stop(); loop.current = null;
    const mine = snap.p.find((p) => p[0] === myId);
    const versus = world?.mode === 'versus' || (snap.p.length > 1 && mode === 'versus');
    const score = versus ? Number(mine?.[6] ?? 0) : snap.score;
    const [title, line] = DEATH_LINES[snap.killer] ?? ['GAME OVER', ''];
    let winner: string | undefined;
    if (versus) { const alive = snap.p.find((p) => !p[10]); winner = alive ? who[String(alive[0])]?.name : undefined; }
    let rank: number | null = null, best = false, note: string | null = null;
    if (world && (role.current === null || role.current.kind === 'host')) {
      const r = await submitRun({ mode: world.mode, score, wave: snap.wave, ship: ship.id, seconds: Math.ceil(world.t), kills: world.stats.kills, notes: world.stats.notes, bombs: world.stats.bombs, peakMult: world.stats.peakMult, players: Object.values(who).map((w) => w.name) });
      rank = r.rank; best = r.best; note = r.note;
    }
    setOver({ title: versus ? (winner === me ? 'LAST NODE STANDING' : 'OUTLASTED') : title, line: versus ? (winner ? `${winner} survived the longest.` : 'Nobody survived. Very private.') : line, score, wave: snap.wave, rank, best, winner, note });
    setScreen('over');
    void setDoing(null);
    void refreshBoard(world?.mode ?? mode, 'week'); setTab({ mode: world?.mode ?? mode, period: 'week' });
  }, [mode, ship.id, me, refreshBoard]);

  /** Runs the frame loop. Host/solo: a World. Guest: snapshots from the host. */
  const run = useCallback((opts: { world: World | null; myId: string; who: Record<string, Who>; host?: HostLink; guest?: GuestLink; inputs?: Record<string, Input> }) => {
    const cv = canvas.current!, g = cv.getContext('2d')!;
    const grid = new Grid(), fx = new Fx(), ear = new Listener(), echo = document.createElement('canvas');
    let silentShown = false;
    const inputs = opts.inputs ?? {};
    let snap: Snapshot | null = opts.world?.snapshot() ?? null, prev: Snapshot | null = null, snapAt = 0, prevAt = 0;
    let pending: GameEvent[] = [], netT = 0, hudT = 0, last = performance.now(), raf = 0, done = false, lastMult = 1;
    const shown = new Set<string>();
    const onEvents = (evs: GameEvent[]) => {
      react(evs, fx, grid, opts.who); sound(evs);
      for (const e of evs) {
        if (e.k === 'wave') { setBanner({ big: `BLOCK ${(3_141_592 + e.n).toLocaleString()} MINED`, small: `${e.title} · ${WAVE_QUIPS[e.n % WAVE_QUIPS.length]}` }); setTimeout(() => setBanner(null), 2400); }
        if (e.k === 'life') { setBanner({ big: '+1 SHIP', small: 'Shielded supply increased.' }); setTimeout(() => setBanner(null), 1600); }
        if (e.k === 'bomb') { setBanner({ big: 'TURNSTILE', small: 'Everything on screen, shielded.' }); setTimeout(() => setBanner(null), 1100); }
      }
    };
    if (opts.guest) opts.guest.onMsg = (m) => {
      if (m.k === 'snap') { prev = snap; prevAt = snapAt; snap = m.s; snapAt = performance.now(); onEvents(m.s.ev); }
      if (m.k === 'end' && snap) { done = true; void finish(snap, null, opts.myId, opts.who); }
    };
    if (opts.host) opts.host.onMsg = (peer, m) => { if (m.k === 'in') inputs[peer] = m.i; };
    const resize = () => { const r = wrap.current!.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap.current!);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (done) return;
      const w = opts.world;
      if (w) {
        const meP = w.players.find((p) => p.id === opts.myId);
        inputs[opts.myId] = pausedRef.current ? NO_INPUT : readInput(meP ? { x: meP.x, y: meP.y } : null);
        if (!pausedRef.current) w.step(dt, inputs);
        const evs = w.events; w.events = [];
        onEvents(evs); pending.push(...evs);
        snap = w.snapshot();
        netT -= dt;
        if (opts.host && netT <= 0) { netT = 1 / 30; opts.host.broadcast({ k: 'snap', s: { ...snap, ev: pending } }); pending = []; }
        if (w.over) { done = true; opts.host?.broadcast({ k: 'snap', s: { ...snap, ev: pending } }); opts.host?.broadcast({ k: 'end' }); void finish(snap, w, opts.myId, opts.who); return; }
      } else if (opts.guest && snap) {
        const mp = snap.p.find((p) => p[0] === opts.myId);
        netT -= dt;
        if (netT <= 0) { netT = 1 / 30; opts.guest.send({ k: 'in', i: readInput(mp ? { x: Number(mp[1]), y: Number(mp[2]) } : null) }); }
      }
      if (!snap) return;
      // guests draw a moment in the past, between the last two snapshots, so motion is smooth
      let draw = snap;
      if (!w && prev && snapAt > prevAt) {
        const f = Math.min(1, (now - snapAt) / (snapAt - prevAt));
        const pe = new Map(prev.e.map((e) => [e[0], e])), pp = new Map(prev.p.map((p) => [p[0], p]));
        draw = { ...snap, e: snap.e.map((e) => { const o = pe.get(e[0]); return o ? [e[0]!, e[1]!, o[2]! + (e[2]! - o[2]!) * f, o[3]! + (e[3]! - o[3]!) * f, ...e.slice(4)] : e; }),
          p: snap.p.map((p) => { const o = pp.get(p[0]); return o ? [p[0]!, Number(o[1]) + (Number(p[1]) - Number(o[1])) * f, Number(o[2]) + (Number(p[2]) - Number(o[2])) * f, ...p.slice(3)] : p; }) };
      }
      grid.update(dt, draw.e.filter((e) => e[1] === 6 && !e[6]).map((e) => ({ x: e[2]!, y: e[3]!, r: e[5]! })));
      fx.update(dt);
      // zecAmp: every kick sends a shockwave through the grid from the middle
      const vb = ear.read(vibeRef.current, dt, now / 1000);
      spectrum(specRef.current, vb, now / 1000);
      if (vb.kick && vb.mode !== 'off') grid.impulse(W / 2, H / 2, 240 + vb.bass * 520, 950);
      const silent = vb.mode !== 'off' && vb.silent;
      if (silent !== silentShown) { silentShown = silent; setVibeSilent(silent); }
      view.current = drawFrame(g, draw, opts.who, grid, fx, now / 1000, cv.width, cv.height, vb, echo);
      hudT -= dt;
      if (hudT <= 0) {
        hudT = 0.1;
        const mine = snap.p.find((p) => p[0] === opts.myId);
        const versus = (w?.mode ?? mode) === 'versus';
        const m = versus ? Number(mine?.[7] ?? 1) : snap.mult;
        if (m > lastMult) for (const [at, call] of Object.entries(MULT_CALLS)) if (m >= +at && lastMult < +at && !shown.has(call)) { shown.add(call); setBanner({ big: call, small: `×${at} multiplier` }); setTimeout(() => setBanner(null), 1400); }
        lastMult = m;
        setHud({
          score: versus ? Number(mine?.[6] ?? 0) : snap.score, mult: m, wave: snap.wave,
          lives: versus ? Number(mine?.[8] ?? 0) : snap.lives, bombs: versus ? Number(mine?.[9] ?? 0) : snap.bombs, height: 3_141_592 + snap.wave,
          others: snap.p.filter((p) => p[0] !== opts.myId).map((p) => ({ name: opts.who[String(p[0])]?.name ?? '?', color: opts.who[String(p[0])]?.color ?? '#fff', score: Number(p[6]), out: Boolean(p[10]) })),
        });
      }
    };
    raf = requestAnimationFrame(frame);
    loop.current = { stop: () => { cancelAnimationFrame(raf); ro.disconnect(); done = true; } };
  }, [readInput, finish, mode]);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => () => { loop.current?.stop(); role.current?.link.close(); void setDoing(null); }, []);

  // ── Starting a game ─────────────────────────────────────────────────────
  /** "Today you are: The Coin." Then go. */
  const reveal = useCallback((then: () => void) => {
    setScreen('reveal');
    setTimeout(() => { setScreen('playing'); requestAnimationFrame(then); }, 2200);
  }, []);

  const startSolo = () => {
    const s = randomShip(); setShip(s); setMode('solo'); setOver(null); setPaused(false);
    reveal(() => {
      const who = { me: { color: PLAYER_COLORS[0]!, ship: s.id, name: me } };
      run({ world: new World('solo', [{ id: 'me', name: me, color: PLAYER_COLORS[0]!, ship: s.id }]), myId: 'me', who });
    });
  };

  /** Host: everyone connected, go. */
  const startHosted = () => {
    const r = role.current; if (r?.kind !== 'host') return;
    const ready = guests.filter((g) => g.state === 'ready');
    if (!ready.length) return;
    const s = ship;
    const players = [{ id: 'host', name: me, color: PLAYER_COLORS[0]!, ship: s.id }, ...ready.slice(0, 3).map((g, i) => ({ id: g.id, name: g.name, color: PLAYER_COLORS[i + 1]!, ship: guestShips.current[g.id] ?? randomShip().id }))];
    const who: Record<string, Who> = Object.fromEntries(players.map((p) => [p.id, { color: p.color, ship: p.ship, name: p.name }]));
    for (const p of players.slice(1)) r.link.send(p.id, { k: 'hello', you: p.id, mode, players });
    void setDoing(DOING_PLAYING);
    setOver(null);
    reveal(() => run({ world: new World(mode, players), myId: 'host', who, host: r.link, inputs: {} }));
  };
  const guestShips = useRef<Record<string, string>>({});

  // ── Lobby ───────────────────────────────────────────────────────────────
  const openLobby = (m: 'coop' | 'versus') => {
    setMode(m); setScreen('lobby'); setLobbyNote(''); setGuests([]);
    const s = randomShip(); setShip(s);
    role.current?.link.close();
    const link = new HostLink(newRoom());
    link.onOpen = (peer) => { setGuests((gs) => gs.map((g) => (g.id === peer ? { ...g, state: 'ready' } : g))); };
    link.onClose = (peer) => setGuests((gs) => gs.filter((g) => g.id !== peer));
    link.onMsg = (peer, msg: GuestMsg) => { if (msg.k === 'me') guestShips.current[peer] = msg.ship; };
    role.current = { kind: 'host', link };
    void setDoing(DOING_HOSTING);
  };
  const invite = async (p: ZimPerson) => {
    const r = role.current; if (r?.kind !== 'host') return;
    if (guests.length >= 3) { setLobbyNote('Four ships is the limit. The grid can only bend so far.'); return; }
    setGuests((gs) => (gs.some((g) => g.id === p.id) ? gs : [...gs, { id: p.id, name: p.handle, state: 'invited' }]));
    try { await sendSignal(p.id, { t: 'invite', room: r.link.room, mode: mode === 'versus' ? 'versus' : 'coop', from: me }); setLobbyNote(`Invite sent to ${p.handle} over ZIM.`); }
    catch (e) { setLobbyNote(e instanceof Error ? e.message : 'Could not send the invite'); }
  };
  /** Guest: answer an invite (or knock on someone hosting). */
  const join = useCallback(async (peerId: string, name: string, room: string, m: 'coop' | 'versus') => {
    role.current?.link.close();
    const link = new GuestLink(room, peerId);
    role.current = { kind: 'guest', link };
    setMode(m); setScreen('lobby'); setLobbyNote(`Connecting to ${name}…`);
    const s = randomShip(); setShip(s);
    link.onOpen = () => { setLobbyNote(`Connected to ${name}. Waiting for them to start.`); link.send({ k: 'me', name: me, ship: s.id }); };
    link.onClose = () => { setLobbyNote(`${name} left. Typical.`); };
    link.onMsg = (msg: HostMsg) => {
      if (msg.k !== 'hello') return;
      const who: Record<string, Who> = Object.fromEntries(msg.players.map((p) => [p.id, { color: p.color, ship: p.ship, name: p.name }]));
      setShip(shipById(msg.players.find((p) => p.id === msg.you)?.ship ?? s.id)); setMode(msg.mode); setOver(null);
      void setDoing(DOING_PLAYING);
      reveal(() => run({ world: null, myId: msg.you, who, guest: link }));
    };
    since.current[peerId] = since.current[peerId] ?? new Date(Date.now() - 60_000).toISOString();
    try { await sendSignal(peerId, { t: 'join', room }); } catch { setLobbyNote('ZIM would not deliver that. Try again?'); }
  }, [me, reveal, run]);

  // a ZIM invite card was clicked before (or while) this window was open
  const pending = useZeometryInvite((s) => s.pending);
  useEffect(() => {
    if (!pending || !verified) return;
    useZeometryInvite.getState().set(null);
    if (mobile) setScreen('menu');
    void join(pending.peerId, 'your buddy', pending.room, pending.mode);
  }, [pending, verified, join, mobile]);

  // poll ZIM while in the menu or lobby: who is online, and any game signals from people in the game
  useEffect(() => {
    if (!verified || !zimReady() || (screen !== 'menu' && screen !== 'lobby')) return;
    if (screen === 'menu') void setDoing(DOING_LOBBY);
    let live = true;
    const tick = async () => {
      try {
        const list = (await buddies()).filter((b) => b.online);
        if (!live) return;
        setPeople(list);
        const watch = list.filter((b) => (b.doing ?? '').includes('Zeometry') || guestsRef.current.some((g) => g.id === b.id) || role.current?.kind === 'guest' && role.current.link.hostId === b.id);
        for (const b of watch) {
          const after = since.current[b.id] ?? new Date(Date.now() - 10 * 60_000).toISOString();
          const { sigs, last } = await signalsFrom(b.id, after);
          since.current[b.id] = last;
          for (const s of sigs) await onSignal(b, s);
        }
      } catch { /* next tick */ }
    };
    void tick();
    const t = setInterval(() => void tick(), 2500);
    return () => { live = false; clearInterval(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, screen]);
  const guestsRef = useRef(guests); guestsRef.current = guests;
  const onSignal = async (from: ZimPerson, s: import('./net').Sig) => {
    const r = role.current;
    if (s.t === 'invite') setInvites((xs) => (xs.some((x) => x.room === s.room) ? xs : [...xs, { peerId: from.id, name: from.handle, room: s.room, mode: s.mode }]));
    else if (s.t === 'join' && r?.kind === 'host') {
      if (!guestsRef.current.some((g) => g.id === from.id)) {
        if (guestsRef.current.length >= 3) { await sendSignal(from.id, { t: 'decline', room: s.room }); return; }
        setGuests((gs) => [...gs, { id: from.id, name: from.handle, state: 'connecting' }]);
      } else setGuests((gs) => gs.map((g) => (g.id === from.id ? { ...g, state: 'connecting' } : g)));
      try { await r.link.offer(from.id); } catch { setLobbyNote(`Could not reach ${from.handle}. Strict networks sometimes block direct play.`); }
    } else if (s.t === 'offer' && r?.kind === 'guest' && r.link.hostId === from.id) {
      const sdp = assembler.current.add(from.id, s); if (!sdp) return;
      try { await r.link.accept(sdp); } catch { setLobbyNote('Could not connect. Strict networks sometimes block direct play.'); }
    } else if (s.t === 'answer' && r?.kind === 'host') {
      const sdp = assembler.current.add(from.id, s); if (!sdp) return;
      try { await r.link.answer(from.id, sdp); } catch { /* stale */ }
    } else if (s.t === 'decline') setLobbyNote(`${from.handle} passed. Probably scared.`);
  };

  // ── Views ───────────────────────────────────────────────────────────────
  const backdrop = <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(1200px 600px at 50% 30%, #121a3a 0%, #05050c 70%)', backgroundImage: 'linear-gradient(rgba(77,124,255,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(77,124,255,.14) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />;
  const logo = (
    <div style={{ textAlign: 'center' }}>
      <div style={{ font: `900 clamp(40px, 7vw, 84px) ${ORB}`, letterSpacing: '.06em', color: '#ffe08a', textShadow: `0 0 30px ${GOLD}, 0 0 60px ${GOLD}77` }}>ZEOMETRY</div>
      <div style={{ font: `700 clamp(20px, 3.2vw, 38px) ${ORB}`, letterSpacing: '.5em', color: CYAN, textShadow: `0 0 18px ${CYAN}`, marginTop: -2 }}>WARS</div>
      <div style={{ ...small, marginTop: 10, fontSize: 13, color: '#c7c7d2' }}>shoot the surveillance. shield the notes.</div>
    </div>
  );

  const boardPanel = (
    <div style={{ ...panel, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['week', 'all'] as Period[]).map((p) => <button key={p} onClick={() => setTab((t) => ({ ...t, period: p }))} style={tabBtn(tab.period === p)}>{p === 'week' ? 'THIS WEEK' : 'ALL TIME'}</button>)}
        <span style={{ width: 8 }} />
        {(['solo', 'coop', 'versus'] as Mode[]).map((m) => <button key={m} onClick={() => setTab((t) => ({ ...t, mode: m }))} style={tabBtn(tab.mode === m)}>{m.toUpperCase()}</button>)}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', font: `500 14px ${HUD_FONT}` }}>
        <tbody>
          {board?.rows.length ? board.rows.slice(0, 10).map((r, i) => (
            <tr key={i} style={{ background: r.mine ? `${GOLD}26` : i % 2 ? 'transparent' : '#ffffff08', color: r.mine ? '#ffe08a' : '#eee' }}>
              <td style={{ padding: '6px 8px', color: CYAN, width: 30 }}>{r.rank}</td>
              <td style={{ padding: '6px 8px' }}>{r.name}{r.badges?.length ? <span style={{ marginLeft: 6 }}><UserBadges keys={r.badges} size={13} /></span> : null}</td>
              <td style={{ padding: '6px 8px', ...small }}>w {r.wave}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ffe08a' }}>{r.score.toLocaleString()}</td>
            </tr>
          )) : <tr><td style={{ ...small, padding: 10 }}>No runs yet. The board is shielded. For now.</td></tr>}
        </tbody>
      </table>
      {board && !board.global && <div style={{ ...small, marginTop: 10 }}>this browser’s runs · the global board switches on with the server update</div>}
      {!verified && <div style={{ ...small, marginTop: 6 }}>verify your account to get on the global board</div>}
    </div>
  );

  if (screen === 'phone') return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden', display: 'grid', placeItems: 'center', padding: 24, background: '#05050c' }}>
      {backdrop}
      <div style={{ position: 'relative', textAlign: 'center', maxWidth: 360 }}>
        {logo}
        <div style={{ ...panel, marginTop: 28 }}>
          <div style={{ font: `700 18px ${ORB}`, color: PINK, textShadow: `0 0 12px ${PINK}`, marginBottom: 10 }}>WARNING</div>
          <p style={{ fontSize: 17, lineHeight: 1.5 }}>Playing this on your phone is gonna be a terrible experience.</p>
          <p style={{ ...small, marginTop: 8 }}>It wants two thumbsticks, a keyboard or a mouse. You have a piece of glass.</p>
          <button onClick={() => setScreen('menu')} style={{ ...btn(true), textAlign: 'center', marginTop: 18, marginBottom: 0 }}>PLAY ANYWAY</button>
        </div>
      </div>
    </div>
  );

  return (
    <div ref={wrap} style={{ position: 'relative', height: '100%', overflow: 'hidden', background: '#03030a', userSelect: 'none' }}
      onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: screen === 'playing' ? 'block' : 'none', cursor: 'crosshair' }}
        onMouseMove={(e) => { const p = toArena(e); mouse.current.x = p.x; mouse.current.y = p.y; }}
        onMouseDown={(e) => { if (e.button === 2) mouse.current.right = true; else mouse.current.down = true; }}
        onMouseUp={(e) => { if (e.button === 2) mouse.current.right = false; else mouse.current.down = false; }}
        onMouseLeave={() => { mouse.current.down = false; mouse.current.right = false; }} />

      {screen !== 'playing' && backdrop}

      {screen === 'menu' && (
        <div style={{ position: 'relative', height: '100%', overflow: 'auto', padding: '36px 28px' }}>
          {logo}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 22, maxWidth: 1060, margin: '32px auto 0' }}>
            <div style={panel}>
              <button style={btn(true)} onClick={startSolo}>SOLO<div style={{ font: '500 12px Inter, sans-serif', opacity: 0.75, marginTop: 3, letterSpacing: 0 }}>score attack · weekly leaderboard</div></button>
              <button style={btn()} disabled={!verified} onClick={() => openLobby('coop')}>CO-OP · 2–4 PLAYERS<div style={{ font: '500 12px Inter, sans-serif', opacity: 0.75, marginTop: 3, letterSpacing: 0 }}>{verified ? 'with ZIM buddies online now · shared score' : 'verified accounts only'}</div></button>
              <button style={btn()} disabled={!verified} onClick={() => openLobby('versus')}>VERSUS<div style={{ font: '500 12px Inter, sans-serif', opacity: 0.75, marginTop: 3, letterSpacing: 0 }}>same arena · last node standing</div></button>
              <div style={{ ...small, marginTop: 6 }}>WASD move · mouse aim, hold to fire · arrows aim + fire · SPACE or right-click: turnstile · gamepad: twin sticks, RB · ESC pause · V music</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <button type="button" onClick={cycleVibe} style={mini(vibe === 'trip' ? PINK : vibe === 'groove' ? CYAN : '#9aa')}>♫ MUSIC: {vibe.toUpperCase()}</button>
                <span style={small}>{vibe === 'off' ? 'Let the arena react to zecAmp.' : vibe === 'groove' ? 'The grid moves to zecAmp.' : 'Trails, splits and colour, to zecAmp.'}</span>
              </div>
            </div>
            <div style={panel}>
              <div style={{ font: `700 14px ${ORB}`, color: CYAN, letterSpacing: '.08em', marginBottom: 12 }}>INVITES & BUDDIES ONLINE</div>
              {!verified && <div style={small}>Online play is for verified accounts, through your ZIM buddy list. Guests can still play solo and get dusted like everyone else.</div>}
              {verified && invites.map((iv) => (
                <div key={iv.room} style={row}>
                  <span><Dot c="#ffb02e" />{iv.name} <span style={small}>invited you · {iv.mode}</span></span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button style={mini('#3ddc84')} onClick={() => { setInvites((x) => x.filter((y) => y.room !== iv.room)); void join(iv.peerId, iv.name, iv.room, iv.mode); }}>JOIN</button>
                    <button style={mini('#9aa')} onClick={() => { setInvites((x) => x.filter((y) => y.room !== iv.room)); void sendSignal(iv.peerId, { t: 'decline', room: iv.room }); }}>PASS</button>
                  </span>
                </div>
              ))}
              {verified && people.map((p) => (
                <div key={p.id} style={row}>
                  <span><Dot c={p.status === 'away' ? '#ffb02e' : '#3ddc84'} />{p.handle} <span style={small}>{p.doing ?? 'online'}</span></span>
                  {(p.doing ?? '').includes('hosting Zeometry') && <button style={mini('#3ddc84')} onClick={() => void join(p.id, p.handle, 'open', 'coop')}>JOIN</button>}
                </div>
              ))}
              {verified && !people.length && !invites.length && <div style={small}>Nobody on your buddy list is online. Add some in ZIM, or go solo. Solo is very private.</div>}
            </div>
          </div>
          <div style={{ maxWidth: 1060, margin: '22px auto 0' }}>{boardPanel}</div>
        </div>
      )}

      {screen === 'lobby' && (
        <div style={{ position: 'relative', height: '100%', overflow: 'auto', padding: '30px 28px' }}>
          <div style={{ textAlign: 'center', font: `900 34px ${ORB}`, color: '#ffe08a', textShadow: `0 0 18px ${GOLD}` }}>{mode === 'versus' ? 'VERSUS' : 'CO-OP'} LOBBY</div>
          <div style={{ ...small, textAlign: 'center', marginTop: 6 }}>{role.current?.kind === 'host' ? 'You are hosting. Your browser runs the game, so close the other tabs full of charts.' : 'Your buddy is hosting.'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 22, maxWidth: 1000, margin: '24px auto 0' }}>
            <div style={panel}>
              <div style={{ font: `700 14px ${ORB}`, color: CYAN, marginBottom: 12 }}>IN THIS GAME</div>
              <div style={row}><span><Dot c={GOLD} />{me} <span style={small}>{role.current?.kind === 'host' ? 'host' : 'you'}</span></span></div>
              {guests.map((g) => <div key={g.id} style={row}><span><Dot c={g.state === 'ready' ? '#3ddc84' : '#ffb02e'} />{g.name}</span><span style={small}>{g.state === 'ready' ? 'connected' : g.state === 'connecting' ? 'connecting…' : 'invited'}</span></div>)}
              {role.current?.kind === 'host' && <button style={{ ...btn(true), marginTop: 14, opacity: guests.some((g) => g.state === 'ready') ? 1 : 0.4 }} onClick={startHosted}>START</button>}
              <button style={{ ...btn(), marginTop: 6 }} onClick={() => { role.current?.link.close(); role.current = null; setGuests([]); setScreen('menu'); }}>LEAVE</button>
              {lobbyNote && <div style={{ ...small, marginTop: 8, color: '#ffe08a' }}>{lobbyNote}</div>}
            </div>
            {role.current?.kind === 'host' && (
              <div style={panel}>
                <div style={{ font: `700 14px ${ORB}`, color: CYAN, marginBottom: 12 }}>INVITE A BUDDY</div>
                {people.map((p) => <div key={p.id} style={row}><span><Dot c="#3ddc84" />{p.handle} <span style={small}>{p.doing ?? 'online'}</span></span><button style={mini(GOLD)} onClick={() => void invite(p)}>INVITE</button></div>)}
                {!people.length && <div style={small}>Nobody on your ZIM buddy list is online right now.</div>}
                <div style={{ ...small, marginTop: 10 }}>Invites arrive as a card in their ZIM chat. They click it, you play.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {screen === 'reveal' && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ ...small, fontSize: 14, letterSpacing: '.3em' }}>TODAY YOU ARE</div>
            <ShipPreview ship={ship} />
            <div style={{ font: `900 40px ${ORB}`, color: '#ffe08a', textShadow: `0 0 20px ${GOLD}` }}>{ship.name.toUpperCase()}</div>
            <div style={{ fontSize: 17, color: '#c7c7d2', marginTop: 8 }}>{ship.tagline}</div>
          </div>
        </div>
      )}

      {screen === 'playing' && hud && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: 12, left: 18 }}>
            <div style={{ font: `900 30px ${ORB}`, color: '#ffe08a', textShadow: `0 0 14px ${GOLD}88` }}>{hud.score.toLocaleString()}</div>
            <div style={{ font: `700 17px ${ORB}`, color: CYAN, textShadow: `0 0 10px ${CYAN}88` }}>× {hud.mult}</div>
          </div>
          <div style={{ position: 'absolute', top: 12, left: 0, right: 0, textAlign: 'center' }}>
            <div style={small}>WAVE</div><div style={{ font: `900 24px ${ORB}`, color: '#fff' }}>{hud.wave}</div>
            <div style={{ ...small, color: GOLD }}>BLOCK {hud.height.toLocaleString()}</div>
          </div>
          <div style={{ position: 'absolute', top: 12, right: 18, textAlign: 'right', font: `700 15px ${ORB}`, color: '#ffd35a', lineHeight: 1.7 }}>
            <div>{'◆ '.repeat(Math.max(0, Math.min(hud.lives, 9)))}<span style={small}>SHIPS</span></div>
            <div style={{ color: CYAN }}>{'⊗ '.repeat(Math.max(0, Math.min(hud.bombs, 9)))}<span style={small}>TURNSTILES</span></div>
            {hud.others.map((o) => <div key={o.name} style={{ color: o.color, fontSize: 13, opacity: o.out ? 0.4 : 1 }}>◆ {o.name} · {o.score.toLocaleString()}{o.out ? ' · out' : ''}</div>)}
          </div>
          <div style={{ position: 'absolute', left: 18, bottom: 14, display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto' }}>
            <button type="button" onClick={cycleVibe} title="Make the arena react to whatever zecAmp is playing (V)" style={{ ...mini(vibe === 'trip' ? PINK : vibe === 'groove' ? CYAN : '#9aa'), display: 'inline-flex', alignItems: 'center', gap: 7 }}>♫ {vibe.toUpperCase()}{vibe !== 'off' && <canvas ref={specRef} width={32} height={12} style={{ width: 32, height: 12 }} aria-hidden />}</button>
            {vibe !== 'off' && vibeSilent && <span style={{ ...small, color: '#ffe08a' }}>play something in zecAmp</span>}
          </div>
          {banner && (
            <div style={{ position: 'absolute', top: '36%', left: 0, right: 0, textAlign: 'center' }}>
              <div style={{ font: `900 30px ${ORB}`, color: '#ffe08a', textShadow: `0 0 18px ${GOLD}` }}>{banner.big}</div>
              <div style={{ ...small, fontSize: 14, color: '#c7c7d2', marginTop: 6 }}>{banner.small}</div>
            </div>
          )}
          {paused && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.55)', pointerEvents: 'auto' }}>
              <div style={{ ...panel, textAlign: 'center' }}>
                <div style={{ font: `900 34px ${ORB}`, color: '#ffe08a' }}>PAUSED</div>
                <div style={{ ...small, margin: '8px 0 16px' }}>Pausing is private. Nobody saw that.</div>
                <button style={{ ...btn(true), textAlign: 'center' }} onClick={() => setPaused(false)}>RESUME</button>
                <button style={{ ...btn(), textAlign: 'center', marginBottom: 0 }} onClick={() => { loop.current?.stop(); setPaused(false); setScreen('menu'); }}>QUIT</button>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === 'over' && over && (
        <div style={{ position: 'relative', height: '100%', overflow: 'auto', padding: '30px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 22, maxWidth: 1060, margin: '0 auto' }}>
            <div style={{ ...panel, textAlign: 'center' }}>
              <div style={{ font: `900 34px ${ORB}`, color: PINK, textShadow: `0 0 18px ${PINK}` }}>{over.title}</div>
              <div style={{ ...small, fontSize: 14, margin: '10px 0 18px', color: '#c7c7d2' }}>{over.line}</div>
              <div style={small}>FINAL SCORE · WAVE {over.wave}</div>
              <div style={{ font: `900 44px ${ORB}`, color: '#ffe08a', textShadow: `0 0 18px ${GOLD}88` }}>{over.score.toLocaleString()}</div>
              <div style={{ font: `700 17px ${ORB}`, color: CYAN, margin: '10px 0 18px' }}>
                {[over.rank ? `#${over.rank} THIS WEEK` : null, over.best ? 'NEW BEST' : null].filter(Boolean).join(' · ') || `flew ${ship.name}`}
              </div>
              {over.note && <div style={{ ...small, color: '#ffb02e', margin: '-8px 0 16px' }}>{over.note}</div>}
              <button style={{ ...btn(true), textAlign: 'center' }} onClick={mode === 'solo' ? startSolo : () => setScreen('menu')}>{mode === 'solo' ? 'PLAY AGAIN' : 'BACK TO LOBBY'}</button>
              <button style={{ ...btn(), textAlign: 'center', marginBottom: 0 }} onClick={() => setScreen('menu')}>MENU</button>
            </div>
            {boardPanel}
          </div>
        </div>
      )}
    </div>
  );
}

const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: '1px solid #ffffff10', font: "500 14px ui-monospace, 'JetBrains Mono', monospace" };
const mini = (c: string): React.CSSProperties => ({ font: "700 12px var(--font-orbitron), ui-monospace, monospace", letterSpacing: '.06em', color: c, background: 'transparent', border: `1px solid ${c}88`, borderRadius: 6, padding: '6px 10px', cursor: 'pointer' });
const tabBtn = (on: boolean): React.CSSProperties => ({ font: "700 12px var(--font-orbitron), ui-monospace, monospace", letterSpacing: '.06em', padding: '6px 11px', borderRadius: 6, cursor: 'pointer', color: on ? '#120e02' : '#ffe08a', background: on ? '#f4b728' : 'transparent', border: `1px solid ${on ? '#f4b728' : '#f4b72866'}` });
function Dot({ c }: { c: string }) { return <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}`, marginRight: 8 }} />; }

/** The ship you got, big and spinning, on the reveal. */
function ShipPreview({ ship }: { ship: ShipDesign }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current!.getContext('2d')!;
    let raf = 0;
    const f = (now: number) => {
      const t = now / 1000;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 220, 220);
      g.setTransform(4, 0, 0, 4, 110, 110); g.rotate(ship.spins ? t * 2 : -Math.PI / 2 + Math.sin(t * 2) * 0.2);
      g.globalCompositeOperation = 'lighter'; g.lineJoin = g.lineCap = 'round'; g.strokeStyle = '#f4b728';
      g.globalAlpha = 0.25; g.lineWidth = 2.6; ship.draw(g, t); g.globalAlpha = 1; g.lineWidth = 0.9; ship.draw(g, t);
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [ship]);
  return <canvas ref={ref} width={220} height={220} style={{ display: 'block', margin: '6px auto' }} />;
}

export { SHIPS };
