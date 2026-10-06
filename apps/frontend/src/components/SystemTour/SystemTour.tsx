'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTourStore, TOUR_SEEN_KEY } from '@/store/tourStore';
import { useWindowStore } from '@/store/windowStore';
import { useExplorerStore } from '@/store/explorerStore';
import { getApp } from '@/config/appRegistry';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { getWorkArea } from '@/utils/workArea';
import XIcon from '@/components/ui/XIcon';

/**
 * The system tour: a first-visit walkthrough of the desktop that drives itself.
 *
 * It PERFORMS what it describes - opens the Z menu, double-clicks Explorer,
 * types a block height, minimizes a window - by clicking the real controls
 * through their `data-tour` handles, so it can never describe a desktop that
 * differs from the one on screen. Every click is announced first: rings close
 * in on the control, it is pressed, and the tour waits for whatever that set
 * off to finish before moving on. Everything underneath is dimmed and
 * unclickable while it runs; the only ways out are its own buttons.
 *
 * The visitor's own windows are PARKED for the duration (hidden, still
 * mounted, so nothing in them is lost) and come back exactly as they were when
 * the tour ends, however it ends. Where the tour needs an app the visitor
 * already has open, it opens its own copy rather than borrowing theirs.
 *
 * Every step's `enter` sets up the WHOLE state it shows (the Explorer window,
 * the block, the open transaction) rather than assuming the previous step did,
 * so Back lands on a correct screen too.
 */

const BLOCK = '3333333';
const X_LINKS = [['project', 'zecos_'], ['developer', 'artoforb']] as const;
/** Rings closing in, then the press, then time for what it opened or closed to settle. */
const HONE_MS = 1400;
const CLICK_MS = 450;
const SETTLE_MS = 900;

// ── DOM plumbing ────────────────────────────────────────────────────────────
const $ = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
const t = (k: string) => `[data-tour="${k}"]`;
const win = (id: string) => $(`[data-window-id="${id}"]`);
const inWin = (id: string, k: string) => { const w = win(id); return w ? $(t(k), w) : null; };
const winBtn = (id: string, b: 'minimize' | 'close') => { const w = win(id); return w ? $(`[data-window-btn="${b}"]`, w) : null; };
const wins = () => useWindowStore.getState().windows;
const isOpen = (id: string) => wins().some((w) => w.id === id);
const dblclick = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
const setValue = typeof window !== 'undefined'
  ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  : undefined;

interface Rect { left: number; top: number; right: number; bottom: number }
interface Mark { rect: Rect; phase: 'hone' | 'click'; n: number }

interface Ctx {
  /** False once the step has been left: every await checks it before acting. */
  alive: () => boolean;
  sleep: (ms: number) => Promise<void>;
  waitFor: <T>(fn: () => T | null | undefined, ms?: number) => Promise<T | null>;
  /** Rings close in on `el`, `act` runs, then a pause for its effect. False if the step was left. */
  press: (el: HTMLElement | null, act: () => void) => Promise<boolean>;
}

interface Run {
  /** How many of the visitor's windows were parked. */
  parked: number;
  active: string | null;
  iconsWereHidden: boolean;
  desktopWasShown: boolean;
  /** App id -> the window id the tour is using for it (the real id, or its own copy). */
  ids: Record<string, string>;
  txWin: string | null;
  /** The transaction window already shown being dragged, so Back does not drag it again. */
  moved: string | null;
}

const rectOf = (el: HTMLElement): Rect => { const q = el.getBoundingClientRect(); return { left: q.left, top: q.top, right: q.right, bottom: q.bottom }; };

function makeCtx(alive: () => boolean, mark: (m: Mark | null, only?: number) => void, seq: { n: number }): Ctx {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  return {
    alive, sleep,
    waitFor: async (fn, ms = 5000) => {
      const end = Date.now() + ms;
      while (alive() && Date.now() < end) {
        const v = fn();
        if (v) return v;
        await sleep(100);
      }
      return null;
    },
    press: async (el, act) => {
      if (!alive()) return false;
      let n = 0;
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        n = ++seq.n;
        mark({ rect: rectOf(el), phase: 'hone', n });
        await sleep(HONE_MS);
        if (!alive()) return false;
      }
      const at = el ? rectOf(el) : null;
      act();
      if (at) {
        const k = ++seq.n;
        mark({ rect: at, phase: 'click', n: k });
        await sleep(CLICK_MS);
        mark(null, k);
      }
      await sleep(SETTLE_MS);
      return alive();
    },
  };
}

/** On a narrow screen the tray hides behind ☰: open it first when a step needs one of its buttons. */
async function revealTray(button: string, c: Ctx) {
  const more = $(t('tray-more'));
  if ($(t(button)) || !more) return;
  await c.press(more, () => more.click());
  await c.waitFor(() => $(t(button)), 1500);
}

/** Opens a panel by pressing its real button (announced); closing is quiet. */
async function openPanel(button: string, panel: string, c: Ctx) {
  await revealTray(button, c);
  if (!$(t(panel))) await c.press($(t(button)), () => $(t(button))?.click());
  await c.waitFor(() => $(t(panel)), 1500);
}
function closePanel(button: string, panel: string) {
  if ($(t(panel))) $(t(button))?.click();
}

/** Types into a React-controlled input the way a person would, a key at a time. */
async function typeInto(el: HTMLInputElement, text: string, c: Ctx) {
  const put = (v: string) => { setValue?.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  put('');
  for (let i = 1; i <= text.length && c.alive(); i++) { put(text.slice(0, i)); await c.sleep(110); }
}

/**
 * The window the tour uses for app `id`, opened by pressing `el` if need be.
 * When the visitor already has `id` open (parked), the tour opens its own copy
 * instead, so their window is never borrowed or changed.
 */
async function ensureWindow(
  id: string, el: HTMLElement | null, act: () => void, run: Run, c: Ctx,
  type = id, prep?: (useId: string) => void,
): Promise<string | null> {
  if (!c.alive()) return null;
  const known = run.ids[id];
  if (known && isOpen(known)) {
    useWindowStore.getState().focusWindow(known);
    return (await c.waitFor(() => win(known))) ? known : null;
  }
  const useId = isOpen(id) ? `${id}-tour` : id;
  await c.press(el, () => {
    if (useId === id) { act(); return; }
    const app = getApp(type);
    if (!app) return;
    prep?.(useId);
    const ws = useWindowStore.getState();
    ws.openWindow({
      id: useId, type, title: app.title, size: app.defaultSize, minSize: app.minSize,
      position: calculateWindowPosition(ws.windows, app.defaultSize, window.innerWidth, window.innerHeight),
    });
  });
  if (!c.alive()) return null;
  run.ids[id] = useId;
  return (await c.waitFor(() => win(useId), 4000)) ? useId : null;
}

const ex = (run: Run) => run.ids.explorer ?? 'explorer';

/** Closes a window the way a person would: bring it forward, press its ✕. */
async function closeWin(id: string, c: Ctx) {
  useWindowStore.getState().focusWindow(id);
  await c.sleep(250);
  const b = winBtn(id, 'close');
  return c.press(b, () => (b ? b.click() : useWindowStore.getState().closeWindow(id)));
}

/** Slides a window to `to` (desktop coordinates), kept inside the work area. */
async function glide(id: string, to: { x: number; y: number }, ms: number, c: Ctx) {
  const w = wins().find((q) => q.id === id);
  if (!w) return false;
  const area = getWorkArea();
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.round(Math.min(Math.max(0, p.x), Math.max(0, area.width - w.size.width))),
    y: Math.round(Math.min(Math.max(0, p.y), Math.max(0, area.height - w.size.height))),
  });
  const from = w.position, dest = clamp(to), frames = Math.max(1, Math.round(ms / 16));
  for (let f = 1; f <= frames; f++) {
    if (!c.alive()) return false;
    const k = f / frames, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    useWindowStore.getState().updatePosition(id, { x: from.x + (dest.x - from.x) * e, y: from.y + (dest.y - from.y) * e });
    await c.sleep(16);
  }
  useWindowStore.getState().updatePosition(id, dest);
  return true;
}

/**
 * Picks the new transaction window up by its title bar, waves it about to show
 * windows move, and sets it down to the right of the block it came from, so it
 * reads as a separate window rather than a page of the first.
 */
async function showOffMove(run: Run, c: Ctx) {
  const id = run.txWin;
  if (!id || run.moved === id) return;
  const bar = win(id)?.querySelector<HTMLElement>('.window-drag-handle') ?? null;
  if (!(await c.press(bar, () => {}))) return;
  const start = wins().find((q) => q.id === id)?.position;
  if (!start) return;
  for (const [dx, dy] of [[90, -30], [-60, 45], [50, 15]] as const) {
    if (!(await glide(id, { x: start.x + dx, y: start.y + dy }, 480, c))) return;
  }
  const parent = wins().find((q) => q.id === ex(run))?.position ?? start;
  if (await glide(id, { x: parent.x + 240, y: parent.y + 30 }, 700, c)) run.moved = id;
}

/** Explorer, opened from its desktop icon, showing block 3,333,333. Resolves to the tx toggle. */
async function ensureBlock(run: Run, c: Ctx) {
  const icon = $(t('icon-explorer'));
  const id = await ensureWindow('explorer', icon, () => icon && dblclick(icon), run, c);
  if (!id) return null;
  const input = await c.waitFor(() => inWin(id, 'explorer-input') as HTMLInputElement | null);
  if (!input || !c.alive()) return null;
  if (input.value !== BLOCK || !inWin(id, 'explorer-txs-toggle')) {
    if (!(await c.press(input, () => input.focus()))) return null;
    await typeInto(input, BLOCK, c);
    input.blur();
    if (!(await c.press(inWin(id, 'explorer-search'), () => inWin(id, 'explorer-search')?.click()))) return null;
  }
  return c.waitFor(() => inWin(id, 'explorer-txs-toggle'), 15000);
}

async function ensureTxList(run: Run, c: Ctx) {
  const toggleBtn = await ensureBlock(run, c);
  if (!toggleBtn || !c.alive()) return null;
  if (!inWin(ex(run), 'explorer-txlist') && !(await c.press(toggleBtn, () => toggleBtn.click()))) return null;
  const list = await c.waitFor(() => inWin(ex(run), 'explorer-txlist'), 2000);
  list?.scrollIntoView({ block: 'nearest' });
  return list;
}

/** A transaction from the block, open in its own window. */
async function ensureTx(run: Run, c: Ctx) {
  if (run.txWin && isOpen(run.txWin)) { useWindowStore.getState().focusWindow(run.txWin); return win(run.txWin); }
  if (!(await ensureTxList(run, c)) || !c.alive()) return null;
  const prior = new Set(wins().map((w) => w.id));
  const row = inWin(ex(run), 'explorer-tx');
  if (!(await c.press(row, () => row?.click()))) return null;
  const id = await c.waitFor(() => wins().find((w) => !prior.has(w.id) && w.id.startsWith('explorer-tx-'))?.id);
  if (!id) return null;
  run.txWin = id;
  return c.waitFor(() => win(id));
}

// ── The steps ───────────────────────────────────────────────────────────────
interface Step {
  title: string;
  body: (run: Run) => ReactNode;
  /** What to spotlight. Several elements are lit as one box around all of them. */
  target?: (run: Run) => (HTMLElement | null)[];
  enter?: (run: Run, c: Ctx) => Promise<unknown>;
  exit?: (run: Run) => void;
  /** How long the card stays up, when its body is not plain text to count. */
  ms?: number;
  /** Dead centre of the viewport: the opening and closing cards. */
  center?: boolean;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to ZEC-OS',
    center: true,
    body: (run) => (
      <>
        A one-minute tour of the desktop. It plays by itself; use Back and Next to go at your own pace,
        or Exit tutorial to leave any time.
        {run.parked > 0 && (
          <span style={{ display: 'block', marginTop: 8 }}>
            Your open windows are tucked away for now. They come back exactly as they were when the
            tour ends, or the moment you exit.
          </span>
        )}
      </>
    ),
  },
  {
    title: 'The Z menu',
    body: () => 'Every app lives here, sorted into Stats, Charts, Tools, Games and more, next to desktop controls like Show Desktop, Stack Em and Close All.',
    target: () => [$(t('zmenu-button')), $(t('zmenu-dropdown'))],
    enter: (_r, c) => openPanel('zmenu-button', 'zmenu-dropdown', c),
    exit: () => closePanel('zmenu-button', 'zmenu-dropdown'),
  },
  {
    title: 'Folders',
    body: () => 'The desktop keeps apps in folders by kind. Double-click a folder to open it.',
    target: () => $$('[data-tour^="folder-"]'),
  },
  {
    title: 'Charts, for example',
    body: () => 'Price, supply and the shielded pools over time. Double-click any chart in here to open it in its own window.',
    target: (run) => [win(run.ids['charts-folder'] ?? 'charts-folder')],
    enter: (run, c) => {
      const f = $(t('folder-charts'));
      return ensureWindow('charts-folder', f, () => f && dblclick(f), run, c);
    },
  },
  {
    title: 'Apps on the desktop',
    body: () => 'Some apps sit right on the desktop. This is Explorer, the block explorer. Let\'s open it.',
    target: () => [$(t('icon-explorer'))],
    // Put the folder away first, or it covers the icon. The ✕ is explained later, with windows.
    enter: async (run, c) => {
      const id = run.ids['charts-folder'];
      if (id && isOpen(id)) await closeWin(id, c);
    },
  },
  {
    title: 'Explore the chain',
    body: () => 'Search any block, transaction or address. Here is block 3,333,333.',
    target: (run) => [win(ex(run))],
    enter: ensureBlock,
  },
  {
    title: 'Every transaction in it',
    body: () => 'The block lists its transactions. Each one opens in a window of its own.',
    target: (run) => [inWin(ex(run), 'explorer-txlist') ?? inWin(ex(run), 'explorer-txs-toggle')],
    enter: ensureTxList,
  },
  {
    title: 'A window of its own',
    body: () => 'The transaction opens in a new window, so the block stays where you left it. Drag any window around by its title bar.',
    target: (run) => [run.txWin ? win(run.txWin) : null],
    enter: async (run, c) => {
      if (await ensureTx(run, c)) await showOffMove(run, c);
    },
  },
  {
    title: 'Minimize',
    body: () => 'Minimized windows wait up in the taskbar, exactly as you left them.',
    target: (run) => [run.txWin ? ($(`[data-window-tab="${run.txWin}"]`) ?? win(run.txWin)) : null],
    enter: async (run, c) => {
      if (!(await ensureTx(run, c)) || !c.alive() || !run.txWin) return;
      const b = winBtn(run.txWin, 'minimize');
      await c.press(b, () => b?.click());
    },
  },
  {
    title: '...and back',
    body: () => 'Click it in the taskbar and it comes straight back.',
    target: (run) => [run.txWin ? win(run.txWin) : null],
    enter: async (run, c) => {
      if (!run.txWin || !isOpen(run.txWin)) return ensureTx(run, c);
      const tab = $(`[data-window-tab="${run.txWin}"]`);
      const id = run.txWin;
      await c.press(tab, () => (tab ? tab.click() : useWindowStore.getState().focusWindow(id)));
    },
  },
  {
    title: 'Tidy up',
    body: () => 'Done with a window? The ✕ in its corner closes it.',
    enter: async (run, c) => {
      // Only the tour's own windows are on screen: the visitor's are parked.
      for (const w of wins().filter((w) => !w.parked).reverse()) {
        if (!c.alive() || !(await closeWin(w.id, c))) return;
      }
      run.txWin = null;
    },
  },
  {
    title: 'Network status',
    body: () => 'The signal icon shows the server\'s health: whether mainnet and testnet are live, latency, block height and price. It blinks orange while the node is under maintenance.',
    target: () => [$(t('net-button')), $(t('net-flyout'))],
    enter: (_r, c) => openPanel('net-button', 'net-flyout', c),
    exit: () => closePanel('net-button', 'net-flyout'),
  },
  {
    title: 'Settings',
    body: () => 'The gear opens Settings: font size, date and time format, sound, themes and wallpaper, all saved to your account when you are signed in.',
    target: (run) => [win(run.ids.settings ?? 'settings')],
    enter: async (run, c) => {
      await revealTray('settings-button', c);
      await ensureWindow('settings', $(t('settings-button')), () => $(t('settings-button'))?.click(), run, c);
    },
    exit: () => closePanel('tray-more', 'tray-panel'),
  },
  {
    title: 'The block ticker',
    body: () => 'Along the bottom, the newest blocks as they land. Click any of them to see it in Explorer.',
    target: () => [$(t('ticker'))],
  },
  {
    title: 'One click, one block',
    body: () => 'Explorer opens right on that block, ready to dig into.',
    target: (run) => [run.ids.block ? win(run.ids.block) : null],
    enter: async (run, c) => {
      const pill = await c.waitFor(() => $(t('ticker-block')), 3000);
      if (!pill || !c.alive()) return;
      const h = pill.dataset.height ?? '';
      const id = await ensureWindow(`explorer-block-${h}`, pill, () => pill.click(), run, c, 'explorer',
        (useId) => useExplorerStore.getState().queueSearch(useId, h, 'block'));
      if (id) run.ids.block = id;
    },
  },
  {
    title: 'Close All',
    body: () => 'Lots open? The Z menu\'s Close All clears the desk in one go.',
    target: () => [$(t('zmenu-closeall'))],
    enter: async (run, c) => {
      await openPanel('zmenu-button', 'zmenu-dropdown', c);
      const item = $(t('zmenu-closeall'));
      if (await c.press(item, () => item?.click())) run.txWin = null;
    },
    exit: () => closePanel('zmenu-button', 'zmenu-dropdown'),
  },
  {
    title: 'Coffee',
    body: () => 'ZEC-OS runs on donations and coffee, and right now there is a lot more coffee than donations. The cup is always here if you would like to tip the balance.',
    target: () => [$(t('coffee-button')), $(t('coffee-panel'))],
    enter: (_r, c) => openPanel('coffee-button', 'coffee-panel', c),
    exit: () => closePanel('coffee-button', 'coffee-panel'),
  },
  {
    title: 'That\'s the tour',
    center: true,
    body: (run) => (
      <>
        Follow along on X for news and updates:
        {/* Labels right-aligned against one column of links. */}
        <span style={{ display: 'grid', gridTemplateColumns: 'auto auto', justifyContent: 'start', columnGap: 10, rowGap: 4, marginTop: 6 }}>
          {X_LINKS.map(([label, handle]) => (
            <Fragment key={handle}>
              <span style={{ textAlign: 'right' }}>{label}:</span>
              <a href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer"
                // Azure, underlined: it must read as a link, not as more gold text.
                style={{ color: '#3ba7ff', fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <XIcon size={15} /> @{handle}
              </a>
            </Fragment>
          ))}
        </span>
        <span style={{ display: 'block', marginTop: 8 }}>
          Run it again any time from System Tutorial on the desktop.
          {run.parked > 0 && ' Finish puts your windows back where they were.'}
        </span>
      </>
    ),
  },
];

/**
 * Reading time, counted from when the step's actions have FINISHED - the card
 * is up the whole time they run, but nobody reads while watching a window open.
 */
function durationMs(s: Step, run: Run) {
  const node = s.body(run);
  if (typeof node !== 'string') return s.ms ?? 10000;
  return Math.min(15000, Math.max(6000, 3500 + node.split(/\s+/).length * 330));
}

type CardPos = { top: number; left: number; w: number };
const overlaps = (p: CardPos, h: number, b: Box) =>
  p.left < b.left + b.width && p.left + p.w > b.left && p.top < b.top + b.height && p.top + h > b.top;

interface Box { top: number; left: number; width: number; height: number }
const PAD = 6;
const CARD_W = 400;
const M = 12;

function unionBox(els: (HTMLElement | null)[], extra?: Rect): Box | null {
  const rects: Rect[] = [];
  for (const el of els) {
    if (!el) continue;
    const q = el.getBoundingClientRect();
    if (q.width >= 1 && q.height >= 1) rects.push(q);
  }
  if (extra) rects.push(extra);
  if (!rects.length) return null;
  const l = Math.min(...rects.map((r) => r.left)), tp = Math.min(...rects.map((r) => r.top));
  const r = Math.max(...rects.map((q) => q.right)), b = Math.max(...rects.map((q) => q.bottom));
  return { top: Math.round(tp - PAD), left: Math.round(l - PAD), width: Math.round(r - l + PAD * 2), height: Math.round(b - tp + PAD * 2) };
}

type Side = 'right' | 'left' | 'below' | 'above' | 'corner';

/** The card in the dead centre of the viewport. */
function centred(h: number): CardPos {
  const w = Math.min(CARD_W, window.innerWidth - M * 2);
  return { top: Math.max(M, Math.round((window.innerHeight - h) / 2)), left: Math.round((window.innerWidth - w) / 2), w };
}

/**
 * Where the card goes: beside the content it describes, to the RIGHT and
 * top-aligned where there is room - so it travels with that content - and to
 * the left when there is none (the taskbar's right-hand icons and their
 * flyouts). Then below, then above, and only then a corner. It keeps the side
 * it is already on for as long as that side still fits, so it glides along
 * with the content instead of flipping from one side to the other.
 *
 * `anchor` is what the step is about; `spot` is everything lit, rings
 * included, which the card must not cover.
 */
function placeCard(anchor: Box | null, spot: Box | null, h: number, keep?: Side, current?: CardPos | null): { pos: CardPos; side: Side } {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - M * 2);
  const TOP = 64, BOTTOM = vh - 60; // clear of the taskbar and the block ticker
  const y = (v: number) => Math.min(Math.max(TOP, v), Math.max(TOP, BOTTOM - h));
  const x = (v: number) => Math.min(Math.max(M, v), vw - w - M);
  if (anchor) {
    const right = anchor.left + anchor.width, bottom = anchor.top + anchor.height;
    const at: Partial<Record<Side, CardPos>> = {};
    if (right + M + w <= vw - M) at.right = { top: y(anchor.top), left: right + M, w };
    if (anchor.left - M - w >= M) at.left = { top: y(anchor.top), left: anchor.left - M - w, w };
    if (bottom + M + h <= BOTTOM) at.below = { top: bottom + M, left: x(right - w), w };
    if (anchor.top - M - h >= TOP) at.above = { top: anchor.top - M - h, left: x(right - w), w };
    const fits = (sd: Side) => { const p = at[sd]; return !!p && !(spot && overlaps(p, h, spot)); };
    const order: Side[] = ['right', 'left', 'below', 'above'];
    const side = keep && fits(keep) ? keep : order.find(fits);
    if (side) return { pos: at[side]!, side };
  }
  // Nothing beside it fits: the corner the lit area covers least, bottom-right first.
  const corners: CardPos[] = [
    { top: y(BOTTOM - h), left: vw - w - M * 2, w }, { top: y(BOTTOM - h), left: M * 2, w },
    { top: TOP, left: vw - w - M * 2, w }, { top: TOP, left: M * 2, w },
  ];
  const cover = (p: CardPos) => !spot ? 0
    : Math.max(0, Math.min(p.left + p.w, spot.left + spot.width) - Math.max(p.left, spot.left))
      * Math.max(0, Math.min(p.top + h, spot.top + spot.height) - Math.max(p.top, spot.top));
  // Nothing to sit beside (or already cornered) and nothing lit under it: stay where it is.
  if ((!anchor || keep === 'corner') && current && cover(current) === 0) return { pos: current, side: 'corner' };
  return { pos: corners.reduce((best, p) => (cover(p) < cover(best) ? p : best)), side: 'corner' };
}

/** Rings closing in on the control about to be pressed; one ring bursting out as it is. */
function Rings({ mark }: { mark: Mark }) {
  const x = (mark.rect.left + mark.rect.right) / 2, y = (mark.rect.top + mark.rect.bottom) / 2;
  const ring = (delay: number, anim: string, ms: number): React.CSSProperties => ({
    position: 'absolute', left: 0, top: 0, width: 120, height: 120, borderRadius: '50%',
    border: '3px solid var(--accent-gold)', boxShadow: '0 0 0 2px rgba(0,0,0,.55), inset 0 0 0 2px rgba(0,0,0,.55)',
    animation: `${anim} ${ms}ms cubic-bezier(.3,0,.2,1) ${delay}ms both`,
  });
  return (
    <div key={mark.n} style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, pointerEvents: 'none' }}>
      {mark.phase === 'hone'
        ? [0, 200, 400].map((d) => <div key={d} style={ring(d, 'zosHone', HONE_MS - 400)} />)
        : <div style={ring(0, 'zosBurst', CLICK_MS)} />}
    </div>
  );
}

const KEYFRAMES = `
@keyframes zosTourBar { from { width: 0 } to { width: 100% } }
@keyframes zosHone {
  0% { transform: translate(-50%,-50%) scale(2.4); opacity: 0 }
  30% { opacity: 1 }
  100% { transform: translate(-50%,-50%) scale(.22); opacity: 1 }
}
@keyframes zosBurst {
  0% { transform: translate(-50%,-50%) scale(.2); opacity: 1 }
  100% { transform: translate(-50%,-50%) scale(1.3); opacity: 0 }
}`;

export function SystemTour() {
  const running = useTourStore((s) => s.running);
  const [i, setI] = useState(0);
  const [ready, setReady] = useState(false);
  /** The visitor's Pause: stops the clock, never the step's own actions. */
  const [paused, setPaused] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [cardPos, setCardPos] = useState<CardPos | null>(null);
  /** Which side of its target the card is on, kept while it still fits. */
  const side = useRef<Side | undefined>(undefined);
  const cardPosRef = useRef<CardPos | null>(null);
  const [mark, setMarkState] = useState<Mark | null>(null);
  const markRef = useRef<Mark | null>(null);
  const seq = useRef({ n: 0 });
  const run = useRef<Run>({ parked: 0, active: null, iconsWereHidden: false, desktopWasShown: false, ids: {}, txWin: null, moved: null });
  const token = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;

  /** Set the mark; with `only`, clear it only if it is still that one. */
  const setMark = useCallback((m: Mark | null, only?: number) => {
    if (only !== undefined && markRef.current?.n !== only) return;
    markRef.current = m;
    setMarkState(m);
  }, []);

  // First visit on a desktop-sized screen: greet once, after the desktop settles.
  useEffect(() => {
    let seen = true;
    try { seen = !!localStorage.getItem(TOUR_SEEN_KEY); } catch { /* storage blocked: do not nag */ }
    if (seen || window.innerWidth <= 640) return;
    const id = setTimeout(() => useTourStore.getState().start(), 1800);
    return () => clearTimeout(id);
  }, []);

  // Starting: put the visitor's windows away and show a clean desktop.
  useEffect(() => {
    if (!running) return;
    const ws = useWindowStore.getState();
    run.current = {
      parked: ws.windows.length, active: ws.activeWindowId,
      iconsWereHidden: ws.iconsHidden, desktopWasShown: ws.desktopShown, ids: {}, txWin: null, moved: null,
    };
    ws.parkAll(true);
    setPaused(false);
    if (ws.iconsHidden) ws.toggleIcons();
    ws.restoreDesktop();
    setI(0);
  }, [running]);

  // Each step: perform its setup, then let the clock run.
  useEffect(() => {
    if (!running) return;
    const mine = ++token.current;
    const alive = () => token.current === mine && useTourStore.getState().running;
    const s = STEPS[i]!;
    setReady(false);
    side.current = undefined; // each step starts from 'right of it' again
    (async () => {
      try { await s.enter?.(run.current, makeCtx(alive, setMark, seq.current)); } catch { /* show the card regardless */ }
      if (alive()) setReady(true);
    })();
    return () => { token.current++; setMark(null); s.exit?.(run.current); };
  }, [i, running, setMark]);

  // Follow the target, and whatever is about to be pressed: windows open, lists load, flyouts appear.
  useEffect(() => {
    if (!running) return;
    const measure = () => {
      const targets = step.target ? step.target(run.current) : [];
      const b = unionBox(targets, markRef.current?.rect);
      setBox((p) => (p && b && p.top === b.top && p.left === b.left && p.width === b.width && p.height === b.height) || (!p && !b) ? p : b);
      // Anchored to the step's own target, never to the rings: a press is not a reason to move the card.
      const h = cardRef.current?.offsetHeight ?? 200;
      const next = step.center ? { pos: centred(h), side: undefined } : placeCard(unionBox(targets), b, h, side.current, cardPosRef.current);
      side.current = next.side;
      setCardPos((p) => {
        const v = p && Math.abs(p.top - next.pos.top) < 2 && Math.abs(p.left - next.pos.left) < 2 ? p : next.pos;
        cardPosRef.current = v;
        return v;
      });
    };
    // Every frame, so the light keeps up with a window being dragged.
    let raf = 0;
    const loop = () => { measure(); raf = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [running, step]);

  /** Ends the tour, however it ends: the tour's windows go, the visitor's come back as they were. */
  const finish = useCallback(() => {
    const r = run.current;
    // Back to the first card now, or the next start would replay this step's setup first.
    setI(0);
    useTourStore.getState().stop();
    const ws = useWindowStore.getState();
    for (const w of ws.windows) if (!w.parked) ws.closeWindow(w.id);
    ws.parkAll(false);
    useWindowStore.setState({ activeWindowId: r.active });
    if (r.iconsWereHidden && !useWindowStore.getState().iconsHidden) ws.toggleIcons();
    if (r.desktopWasShown) ws.showDesktop();
  }, []);
  const next = useCallback(() => setI((n) => Math.min(n + 1, STEPS.length - 1)), []);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // While it runs, the keyboard belongs to the tour too.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (!ready) return; if (last) finish(); else next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [running, ready, last, next, back, finish]);

  /*
   * Swallow presses before they reach the document: the taskbar closes its
   * menus and flyouts on any outside mousedown, which would shut the very
   * thing a step is showing the moment someone clicks Next.
   */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const kinds = ['mousedown', 'pointerdown', 'touchstart'] as const;
    kinds.forEach((k) => el.addEventListener(k, stop));
    return () => kinds.forEach((k) => el.removeEventListener(k, stop));
  }, [running]);

  if (!running || typeof document === 'undefined') return null;

  const pos = cardPos ?? centred(cardRef.current?.offsetHeight ?? 200);
  const btn: React.CSSProperties = {
    font: 'inherit', fontSize: 14, fontWeight: 700, padding: '7px 15px', cursor: 'pointer',
    borderRadius: 'var(--radius-sm, 4px)', border: '1px solid var(--border-window)',
    background: 'none', color: 'var(--text-primary)',
  };

  return createPortal(
    <div ref={rootRef} style={{ position: 'fixed', inset: 0, zIndex: 2147483000, fontFamily: 'var(--font-primary)' }}>
      <style>{KEYFRAMES}</style>
      {/* The dim IS the spotlight: one box with an enormous spread shadow. */}
      <div style={{
        position: 'absolute', pointerEvents: 'none', borderRadius: 8,
        boxShadow: `0 0 0 200vmax rgba(0,0,0,${box ? 0.62 : 0.7})`,
        transition: 'top .15s ease, left .15s ease, width .15s ease, height .15s ease',
        ...(box
          ? { ...box, outline: '2px solid var(--accent-gold)' }
          : { top: '50%', left: '50%', width: 0, height: 0 }),
      }} />

      {/* Under the card: the big outer rings must not cross its text. */}
      {mark && <Rings mark={mark} />}

      <div
        ref={cardRef}
        style={{
          position: 'absolute', top: pos.top, left: pos.left, width: pos.w,
          background: 'var(--bg-window)', color: 'var(--text-primary)',
          border: '1px solid var(--accent-gold)', borderRadius: 8, padding: '15px 18px 14px',
          boxShadow: '0 18px 50px rgba(0,0,0,.6)', transition: 'top .45s cubic-bezier(.22,1,.36,1), left .45s cubic-bezier(.22,1,.36,1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: 'var(--accent-gold)' }}>
            {i + 1} / {STEPS.length}
          </span>
          <span style={{ fontSize: 18, fontWeight: 750 }}>{step.title}</span>
        </div>
        <div style={{ margin: '8px 0 0', fontSize: 15, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          {step.body(run.current)}
        </div>

        {/* The clock. Starts once the step's actions are done; Pause holds it. */}
        {!last && (
          <div style={{ marginTop: 12, height: 3, background: 'var(--border-window)', overflow: 'hidden', borderRadius: 2 }}>
            <div
              key={`${i}-${ready}`}
              onAnimationEnd={next}
              style={{
                height: '100%', width: 0, background: 'var(--accent-gold)',
                animation: ready ? `zosTourBar ${durationMs(step, run.current)}ms linear forwards` : 'none',
                animationPlayState: paused ? 'paused' : 'running',
              }}
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          {/* In the card, because the card is always placed clear of whatever is lit. */}
          <button style={{ ...btn, border: 'none', padding: '7px 0', fontWeight: 600, color: 'var(--text-muted)' }} onClick={finish}>
            ✕ Exit tutorial
          </button>
          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'right' }}>
            {!ready ? 'working…' : ''}
          </span>
          {!last && (
            <button style={btn} onClick={() => setPaused((v) => !v)} title={paused ? 'Resume playing by itself' : 'Stop moving on by itself'}>
              {paused ? '▶ Resume' : '❚❚ Pause'}
            </button>
          )}
          {i > 0 && <button style={btn} onClick={back}>Back</button>}
          <button
            disabled={!ready}
            title={ready ? undefined : 'Available once this step has finished'}
            style={{
              ...btn, background: 'var(--accent-gold)', color: 'var(--bg-desktop)', borderColor: 'var(--accent-gold)',
              ...(ready ? {} : { opacity: 0.4, cursor: 'not-allowed' }),
            }}
            onClick={last ? finish : next}
          >{last ? 'Finish' : 'Next'}</button>
        </div>
      </div>

    </div>,
    document.body,
  );
}
