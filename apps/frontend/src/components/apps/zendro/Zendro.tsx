'use client';

import { useEffect, useRef } from 'react';
import { IBM_Plex_Mono, Michroma } from 'next/font/google';
import { useWindowStore } from '@/store/windowStore';
import { useExplorerStore } from '@/store/explorerStore';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import history from '@/data/zendroHistory.json';
import { mountZendro, ZENDRO, type ZendroBrand, type ZendroEvent, type ZendroOptions } from './engine';

// Not preloaded: only this app uses them, and a preload on every page is wasted (and warned about).
const display = Michroma({ weight: '400', subsets: ['latin'], variable: '--zd-display', preload: false });
const mono = IBM_Plex_Mono({ weight: ['400', '500', '600'], subsets: ['latin'], variable: '--zd-mono', preload: false });

/** Block heights and hashes open in the Explorer, one window per query. */
function openExplorer(q: string) {
  const { windows, openWindow, focusWindow } = useWindowStore.getState();
  const id = `explorer-zendro-${q.slice(0, 16)}`;
  if (windows.find((w) => w.id === id)) { focusWindow(id); return; }
  const size = { width: 760, height: 680 };
  const position = calculateWindowPosition(windows, size, window.innerWidth, window.innerHeight);
  openWindow({ id, type: 'explorer', title: /^\d+$/.test(q) ? `Block #${Number(q).toLocaleString()}` : 'Explorer', position, size, minSize: { width: 500, height: 400 } });
  useExplorerStore.getState().queueSearch(id, q, 'block');
}

/**
 * Zendrochronology ("Zendro"): Zcash history as a flight down a hollow tree.
 * The scene and its panels are plain DOM + three.js, mounted by `engine.ts`.
 */
export default function Zendro() {
  return <ZendroView events={history as ZendroEvent[]} brand={ZENDRO} />;
}

/** One trunk: Zendro itself, or an offshoot with its own events and name. */
export function ZendroView({ events, brand, music }: { events: ZendroEvent[]; brand: ZendroBrand; music?: ZendroOptions['music'] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !events.length) return;
    let dispose: (() => void) | null = null, gone = false;
    // The year labels are drawn to canvas, so the face has to be loaded first.
    const family = getComputedStyle(el).getPropertyValue('--zd-mono').trim();
    const ready = document.fonts ? document.fonts.load(`500 46px ${family}`).catch(() => []) : Promise.resolve([]);
    // A shared link (/<brand>?e=<event>&s=<section>) opens straight onto its card.
    const q = new URLSearchParams(window.location.search);
    const start = { event: q.get('e'), section: q.get('s') };
    void ready.then(() => { if (!gone) dispose = mountZendro(el, events, { openExplorer, start, brand, music }); });
    return () => { gone = true; dispose?.(); };
  }, [events, brand, music]);
  return (
    <div className={`zendro ${display.variable} ${mono.variable}`} data-own-buttons>
      <style>{CSS}</style>
      {events.length ? <div ref={ref} className="zd-stage" /> : <div className="zd-empty">NO RINGS YET</div>}
    </div>
  );
}

const CSS = `
.zendro .zd-empty { display: grid; place-items: center; height: 100%; font: 500 11px var(--mono); letter-spacing: .3em; color: var(--gold-dim); }
.zendro { position: relative; width: 100%; height: 100%; min-height: 0; background: #000; color: var(--gold);
  /* the theme (engine.ts THEMES) overrides these on the root */
  --gold: #f4b728; --gold-hi: #ffe2a0; --gold-dim: #b88a2a; --g: 244,183,40; --link: #6fe3c4; --glass: rgba(12,9,3,.62);
  --u0: #9a6a0c; --u1: #f4b728; --u2: #ffe9a6; --dot-a: #f4b728; --dot-b: #ffe2a0; --dot-c: #9a6a0c; --scan: .18;
  --display: var(--zd-display), "Eurostile", "Arial Narrow", sans-serif;
  --mono: var(--zd-mono), ui-monospace, "SF Mono", Menlo, monospace;
  font: 14px/1.6 var(--mono); }
.zendro *, .zendro *::before, .zendro *::after { box-sizing: border-box; }
.zendro a { color: inherit; }
.zendro :focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
.zendro .zd-stage { position: absolute; inset: 0; container-type: size; overflow: hidden; isolation: isolate; user-select: none; -webkit-user-select: none; }
.zendro canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.zendro .zd-vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,.55) 100%); }
.zendro .zd-scan { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: multiply; background: repeating-linear-gradient(0deg, rgba(0,0,0,var(--scan)) 0 1px, transparent 1px 3px); z-index: 12; }

/* metal sheen borders, after the Pools buttons: a 110deg gradient sliding along */
.zendro .sheen::before { content: ""; position: absolute; inset: 0; padding: 1px; pointer-events: none; border-radius: inherit; z-index: 1;
  background: linear-gradient(110deg, var(--m0) 0%, var(--m1) 30%, var(--m2) 45%, var(--m1) 60%, var(--m0) 100%);
  background-size: 260% 100%; animation: zd-sheen 4s linear infinite;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
.zendro .sheen::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; box-shadow: 0 0 18px -4px var(--m1), inset 0 0 30px -12px var(--m1); opacity: .55; }
/* One tile per loop, so the last frame is the first: the gradient is 2.6x the box and starts and
   ends on the same colour, and with that size a percentage moves (1 - 2.6) = -1.6 box widths per
   100%. One tile (2.6 widths) is therefore exactly -162.5%. Anything else jumps when it wraps. */
@keyframes zd-sheen { from { background-position: 0 0 } to { background-position: -162.5% 0 } }
/* list and search: metals chasing round the border, tiled so the loop has no seam */
.zendro .sheen.multi::before { padding: 1.5px; background: linear-gradient(90deg, #3fcfa9 0%, #a8773a 25%, #f4b728 50%, #9966ff 75%, #3fcfa9 100%) 0 0 / 50% 100% repeat-x; animation: zd-multi 6s linear infinite; }
.zendro .sheen.multi::after { box-shadow: 0 0 22px -6px #f4b728, inset 0 0 34px -14px #3fcfa9; }
.zendro .sheen.multi2::before { padding: 1.5px; background: linear-gradient(90deg, #9966ff 0%, #3fcfa9 33%, #f4b728 66%, #9966ff 100%) 0 0 / 50% 100% repeat-x; animation: zd-multi 5s linear infinite; }
.zendro .sheen.multi2::after { box-shadow: 0 0 22px -6px #9966ff, inset 0 0 34px -14px #3fcfa9; }
@keyframes zd-multi { from { background-position: 0 0 } to { background-position: 100% 0 } }
.zendro .glass { background: var(--glass); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); text-shadow: 0 0 6px rgba(var(--g),.35); }

/* HUD */
.zendro .zd-hud { position: absolute; z-index: 6; font: 500 10.5px/1.5 var(--mono); letter-spacing: .14em; text-transform: uppercase; }
.zendro .zd-hud.tl { top: 14px; left: 16px; padding: 8px 12px 9px; border-radius: 2px; }
.zendro .zd-hud.tl .lbl { color: var(--gold-dim); }
.zendro .zd-hud.tl .lbl b { color: var(--gold); font-weight: 600; }
.zendro .zd-hud.tl .date { font-size: 16px; letter-spacing: .06em; color: var(--gold-hi); font-variant-numeric: tabular-nums; }
.zendro .zd-hud.tl .blk { font-variant-numeric: tabular-nums; }
.zendro .zd-hud.tl .blk a { text-decoration: none; border-bottom: 1px dotted currentColor; }
.zendro .zd-hud.tl .blk a:hover { border-bottom-style: solid; }
.zendro .zd-hud.tr { top: 12px; right: 14px; display: flex; gap: 8px; align-items: stretch; }
.zendro .slider { position: relative; width: min(520px, 46cqw); padding: 8px 14px 6px; border-radius: 2px; cursor: ew-resize; touch-action: none; }
.zendro .track { position: relative; height: 30px; }
.zendro .track .rail { position: absolute; left: 0; right: 0; top: 15px; height: 1px; background: var(--gold); opacity: .35; }
.zendro .track .fill { position: absolute; left: 0; top: 14px; height: 3px; background: linear-gradient(90deg, rgba(var(--g),.05), rgba(var(--g),.6)); }
.zendro .track .tick { position: absolute; top: 9px; width: 2px; margin-left: -1px; height: 13px; opacity: .7; }
.zendro .track .tick.big { top: 6px; height: 19px; }
.zendro .track .tick.on { top: 3px; height: 25px; opacity: 1; box-shadow: 0 0 8px currentColor; }
.zendro .track .cur { position: absolute; top: 10px; width: 11px; height: 11px; margin-left: -5.5px; transform: rotate(45deg); border: 1.5px solid var(--gold-hi); background: rgba(0,0,0,.6); box-shadow: 0 0 10px rgba(var(--g),.6); }
.zendro .yrs { position: relative; height: 14px; font-size: 9.5px; letter-spacing: .1em; color: var(--gold-dim); }
.zendro .yrs span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.zendro .listbtn, .zendro .srchbtn { position: relative; width: 46px; display: grid; place-items: center; border-radius: 2px; cursor: pointer; border: 0; color: var(--gold); padding: 0; font: inherit; }
.zendro .listbtn svg, .zendro .srchbtn svg { width: 18px; height: 18px; position: relative; z-index: 2; }
.zendro .listbtn:hover, .zendro .srchbtn:hover { color: var(--gold-hi); }
.zendro .listbtn[aria-expanded="true"], .zendro .srchbtn[aria-expanded="true"] { background: rgba(var(--g),.22); color: var(--gold-hi); }

/* events list + search */
.zendro .list, .zendro .search { position: absolute; z-index: 7; top: 82px; right: 14px; width: min(680px, calc(100% - 28px)); max-height: calc(100% - 156px); display: flex; flex-direction: column; border-radius: 3px; transform-origin: top right; transform: scaleY(0); visibility: hidden; transition: transform .1s cubic-bezier(.2,.9,.2,1), visibility 0s .1s; }
.zendro .search { width: min(560px, calc(100% - 28px)); }
.zendro .list.on, .zendro .search.on { transform: none; visibility: visible; transition: transform .12s cubic-bezier(.2,.9,.2,1); }
.zendro .lhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px 7px 18px; font-size: 10.5px; letter-spacing: .2em; color: var(--gold); border-bottom: 1px solid rgba(var(--g),.16); position: relative; z-index: 2; }
.zendro .search .lhead { gap: 12px; padding-left: 14px; }
.zendro .search .lhead svg { flex: none; color: var(--gold-dim); }
.zendro .x { all: unset; cursor: pointer; width: 26px; height: 26px; display: grid; place-items: center; color: var(--gold); border: 1px solid rgba(var(--g),.45); }
.zendro .x:hover, .zendro .x:focus-visible { background: var(--gold); color: #000; text-shadow: none; }
.zendro .list .scroll, .zendro .search .scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 6px 10px 12px; position: relative; z-index: 2; scrollbar-width: auto; scrollbar-color: var(--gold) rgba(var(--g),.08); }
.zendro .scroll::-webkit-scrollbar { width: 11px; }
.zendro .scroll::-webkit-scrollbar-track { background: rgba(var(--g),.07); border-radius: 6px; }
.zendro .scroll::-webkit-scrollbar-thumb { background: linear-gradient(180deg, var(--gold-hi), var(--gold) 40%, var(--gold-dim)); border-radius: 6px; border: 2px solid rgba(12,9,3,.9); }
.zendro .scroll::-webkit-scrollbar-thumb:hover { background: var(--gold-hi); }
.zendro .list .row { display: grid; grid-template-columns: 92px minmax(0, 1fr) 84px 124px; gap: 10px; align-items: baseline; padding: 4px 6px; font-size: 11.5px; border-top: 1px solid rgba(var(--g),.1); }
.zendro .list .row:first-child { border-top: 0; }
.zendro .list .row.on { background: rgba(var(--g),.12); }
.zendro .list .when { color: var(--gold-dim); font-size: 10.5px; letter-spacing: .06em; font-variant-numeric: tabular-nums; }
.zendro .list .go { all: unset; cursor: pointer; color: var(--gold); text-transform: uppercase; letter-spacing: .08em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zendro .list .go:hover, .zendro .list .go:focus-visible { color: var(--gold-hi); text-decoration: underline; }
.zendro .list .go i, .zendro .search .ht i { font-style: normal; display: inline-block; width: 7px; height: 7px; margin-right: 8px; transform: rotate(45deg); background: var(--c, var(--hc)); box-shadow: 0 0 6px var(--c, var(--hc)); }
.zendro .list .n { text-align: right; font-variant-numeric: tabular-nums; }
.zendro .list a, .zendro .search a { color: var(--link); text-decoration: none; border-bottom: 1px dotted currentColor; text-shadow: 0 0 6px rgba(111,227,196,.35); }
.zendro .list a:hover, .zendro .search a:hover { border-bottom-style: solid; color: #b6ffe8; }
.zendro .list .h { font-size: 10.5px; }
.zendro .list .official { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 12px 6px 2px; margin-top: 6px; border-top: 1px solid rgba(var(--g),.16); font-size: 10.5px; letter-spacing: .1em; }
.zendro .list .official a { color: var(--gold); text-shadow: none; }
.zendro .search .q { flex: 1; min-width: 0; background: transparent; border: 0; border-bottom: 1px solid rgba(var(--g),.4); color: var(--gold-hi); font: 500 14px/1.6 var(--mono); letter-spacing: .08em; padding: 3px 2px; outline: none; caret-color: #3fcfa9; text-shadow: 0 0 6px rgba(var(--g),.4); }
.zendro .search .q:focus { border-bottom-color: #3fcfa9; }
.zendro .search .q::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
.zendro .search .q::placeholder { color: rgba(184,138,42,.7); letter-spacing: .14em; font-size: 11px; }
.zendro .search .note { padding: 10px 6px; font-size: 11px; letter-spacing: .16em; color: var(--gold-dim); }
.zendro .search .note b { color: #3fcfa9; font-weight: 500; }
.zendro .search .hit { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 7px 8px; border-top: 1px solid rgba(var(--g),.1); cursor: pointer; }
.zendro .search .hit:hover, .zendro .search .hit.act { background: linear-gradient(90deg, color-mix(in srgb, var(--hc) 14%, transparent), transparent 80%); }
.zendro .search .ht { color: var(--gold); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zendro .search .hw { font-size: 10.5px; color: var(--gold-dim); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.zendro .search .hx { grid-column: 1 / -1; font-size: 11px; color: rgba(var(--g),.75); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 15px; }
.zendro .search .tag { font-size: 9px; letter-spacing: .18em; padding: 1px 5px; margin-right: 7px; border: 1px solid currentColor; }
.zendro .search mark { background: linear-gradient(transparent 58%, color-mix(in srgb, var(--hc) 45%, transparent) 58%); color: var(--hl); text-shadow: 0 0 8px var(--hc); padding: 0 1px; }

/* the box that grows out of the line */
.zendro .box { position: absolute; left: 0; top: 0; z-index: 4; overflow: hidden; border-radius: 2px; width: 0; height: 0; pointer-events: auto; }
.zendro .box .inner { position: absolute; top: 0; left: 0; width: var(--bw); }
.zendro .box.left .inner { left: auto; right: 0; }
.zendro .box .hdr { position: relative; padding: 9px 34px 10px 13px; cursor: pointer; }
.zendro .list .gc { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.zendro .list .gc .go { min-width: 0; }
.zendro .dbk { all: unset; display: inline-block; margin-top: 7px; padding: 3px 8px 2px; font: 600 9.5px/1.3 var(--mono); letter-spacing: .22em; color: #ff6b6b; border: 1.5px solid #ff6b6b; transform: rotate(-2deg); cursor: pointer; opacity: .85; transition: opacity .15s, background .15s; }
.zendro .dbk.sm { flex: none; margin: 0 8px 0 0; padding: 1px 5px 0; font-size: 8.5px; letter-spacing: .18em; border-width: 1px; vertical-align: 1px; }
.zendro .dbk[hidden] { display: none; }
.zendro .dbk:hover, .zendro .dbk:focus-visible { opacity: 1; background: rgba(255,107,107,.14); }
.zendro .term .verdict { color: #f2efe8; margin: 0 0 8px; }
.zendro .share { all: unset; box-sizing: border-box; display: inline-grid; place-items: center; position: relative; width: 20px; height: 20px; color: var(--gold); opacity: .38; cursor: pointer; transition: opacity .15s, color .15s; }
.zendro .share:hover, .zendro .share:focus-visible { opacity: 1; }
.zendro .share.ok { color: #7fe0b8; opacity: 1; }
.zendro .box .share { position: absolute; top: 7px; right: 8px; }
.zendro .term .share.inline { vertical-align: -5px; margin-left: 8px; }
.zendro .share::after { content: attr(data-tip); position: absolute; right: calc(100% + 6px); top: 50%; transform: translateY(-50%); padding: 3px 7px; font: 500 9.5px/1.3 var(--mono); letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; color: #f2efe8; background: rgba(8,8,10,.92); border: 1px solid var(--m1); opacity: 0; pointer-events: none; transition: opacity .12s; }
.zendro .share:hover::after, .zendro .share:focus-visible::after, .zendro .share.ok::after { opacity: 1; }
.zendro .box .hdr::after { content: ""; position: absolute; left: 13px; right: 13px; bottom: 0; height: 1px; background: linear-gradient(90deg, var(--m2), var(--m1) 45%, rgba(var(--g),.15)); opacity: var(--open, 0); box-shadow: 0 0 6px var(--m1); }
.zendro .box .d { font: 500 10px/1.4 var(--mono); letter-spacing: .16em; color: #f2efe8; white-space: nowrap; overflow: hidden; min-height: 1.4em; }
.zendro .box .t, .zendro .tmeasure { font: 400 17px/1.25 var(--display); letter-spacing: .12em; text-transform: uppercase; color: var(--gold); white-space: nowrap; min-height: 1.25em; }
.zendro .box .t.wrap { white-space: normal; overflow-wrap: anywhere; }
.zendro .tmeasure { position: absolute; visibility: hidden; pointer-events: none; left: -9999px; top: 0; }
.zendro .box .bd { padding: 9px 13px 12px; font-size: 12px; line-height: 1.55; color: var(--gold); }
.zendro .box .txt { position: relative; }
.zendro .box .txt .ghost { visibility: hidden; }
.zendro .box .txt .typed { position: absolute; inset: 0; }
.zendro .box .oc { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; }
.zendro .box .oc a, .zendro .term a.hash, .zendro .term .facts a { text-decoration: none; border-bottom: 1px dotted currentColor; }
.zendro .box .oc a:hover, .zendro .term a.hash:hover { border-bottom-style: solid; }
.zendro .btn { font: 500 10.5px/1 var(--mono); letter-spacing: .16em; color: var(--gold); background: rgba(var(--g),.06); border: 1px solid rgba(var(--g),.55); padding: 8px 10px; cursor: pointer; margin-top: 10px; text-transform: uppercase; }
.zendro .btn:hover { background: var(--gold); color: #000; text-shadow: none; }
.zendro .btn.glow { border: 1px solid transparent; background: linear-gradient(rgba(14,10,3,.88), rgba(14,10,3,.88)) padding-box, linear-gradient(110deg, #9a6a0c 0%, #f4b728 28%, #3fcfa9 46%, #b6ffe8 50%, #3fcfa9 54%, #f4b728 72%, #9a6a0c 100%) border-box; background-size: 100% 100%, 260% 100%; animation: zd-glow 3s linear infinite; box-shadow: 0 0 10px -3px rgba(63,207,169,.5); }
.zendro .btn.glow:hover { background: var(--gold); color: #000; animation: none; }
@keyframes zd-glow { from { background-position: 0 0, 0 0 } to { background-position: 0 0, -162.5% 0 } }

/* branch terminal */
.zendro .term { position: absolute; z-index: 4; top: 86px; right: 16px; width: min(480px, calc(100% - 32px)); height: 0; overflow: hidden; border-radius: 2px; pointer-events: auto; }
.zendro .term .scroll { position: absolute; inset: 0; overflow: auto; padding: 16px 18px 18px; scrollbar-width: thin; scrollbar-color: #8a6a1c transparent; z-index: 2; }
.zendro .term h3 { margin: 0 0 3px; font: 400 19px/1.2 var(--display); letter-spacing: .1em; text-transform: uppercase; color: var(--gold); text-wrap: balance; overflow-wrap: anywhere; }
.zendro .term .meta { font-size: 10.5px; letter-spacing: .14em; color: var(--gold-dim); margin-bottom: 10px; }
.zendro .term .chip { display: inline-block; font-size: 9.5px; letter-spacing: .16em; padding: 2px 6px; border: 1px solid var(--m1); color: var(--gold); margin-right: 8px; }
.zendro .term .depth { display: flex; align-items: center; gap: 5px; margin-bottom: 10px; font-size: 10px; letter-spacing: .18em; color: var(--gold-dim); }
.zendro .term .depth i { width: 14px; height: 3px; background: rgba(var(--g),.2); }
.zendro .term .depth i.past { background: rgba(var(--g),.55); }
.zendro .term .depth i.on { background: var(--m2); box-shadow: 0 0 6px var(--m1); }
.zendro .term .depth span { margin-left: 6px; }
.zendro .term .h { font-size: 10px; letter-spacing: .22em; color: var(--gold-dim); margin: 10px 0 4px; }
.zendro .term p { margin: 0 0 6px; font-size: 12px; color: var(--gold); }
.zendro .term ul { margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--gold); }
.zendro .term li { padding-left: 14px; position: relative; }
.zendro .term li::before { content: "\\203a"; position: absolute; left: 0; opacity: .6; }
.zendro .term .hash { font-size: 11px; word-break: break-all; }
.zendro .term .nav { display: flex; flex-wrap: wrap; gap: 0 8px; margin-top: 6px; }
.zendro .term .jump { all: unset; cursor: pointer; color: var(--gold); border-bottom: 1px dotted rgba(var(--g),.6); }
.zendro .term .jump:hover, .zendro .term .jump:focus-visible { color: var(--gold-hi); border-bottom-style: solid; }
.zendro .term .dim { color: var(--gold-dim); }
.zendro .term .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; margin: 4px 0; }
.zendro .term .facts div { font-size: 11.5px; color: var(--gold); min-width: 0; }
.zendro .term .facts span { display: block; font-size: 9.5px; letter-spacing: .2em; color: var(--gold-dim); }
.zendro .term .facts b { font-weight: 500; letter-spacing: .12em; }

.zendro .ctrl { position: absolute; z-index: 6; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 6px; }
.zendro .ctrl button { font: 500 10.5px/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; padding: 9px 12px; background: rgba(0,0,0,.55); color: var(--gold); border: 1px solid rgba(var(--g),.6); cursor: pointer; -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.zendro .ctrl button:hover { border-color: var(--gold); }
.zendro .ctrl button[aria-pressed="true"] { background: var(--gold); color: #000; }

/* the app's own width decides, not the browser's: a half-width pane is narrow too */
@container (max-width: 860px) {
  .zendro .zd-hud.tl { padding: 6px 9px; font-size: 9.5px; }
  .zendro .zd-hud.tl .date { font-size: 13px; }
  .zendro .zd-hud.tr { top: auto; bottom: 62px; right: 10px; left: 10px; }
  .zendro .slider { flex: 1; width: auto; }
  .zendro .list, .zendro .search { top: auto; bottom: 130px; right: 10px; width: calc(100% - 20px); max-height: 56%; transform-origin: bottom right; }
  .zendro .list .row { grid-template-columns: 74px minmax(0, 1fr) 76px; }
  .zendro .list .h { display: none; }
  .zendro .term { top: 108px; right: 10px; width: calc(100% - 20px); }
}
/* phosphor: the old screen's flicker */
.zendro .zd-stage[data-theme="crt"] .zd-scan { animation: zd-flick 5s steps(1) infinite; }
@keyframes zd-flick { 0%, 100% { opacity: 1 } 47% { opacity: .86 } 48% { opacity: 1 } 81% { opacity: .92 } 82% { opacity: 1 } }
/* corner: help and theme */
.zendro .corner { position: absolute; z-index: 6; left: 16px; bottom: 14px; display: flex; gap: 6px; }
.zendro .helpbtn, .zendro .themebtn, .zendro .musicbtn { position: relative; width: 38px; height: 38px; display: grid; place-items: center; border: 0; padding: 0; border-radius: 2px; cursor: pointer; color: var(--gold); font: inherit; }
.zendro .helpbtn svg, .zendro .musicbtn svg { position: relative; z-index: 2; }
.zendro .musicbtn:hover { color: var(--gold-hi); }
.zendro .musicbtn .strike { display: none; }
.zendro .musicbtn.off { color: var(--gold-dim); }
.zendro .musicbtn.off .strike { display: inline; }
.zendro .helpbtn:hover { color: var(--gold-hi); }
/* registered so the dot's colours can cross-fade; an unregistered property would snap */
@property --zd-a { syntax: "<color>"; inherits: false; initial-value: transparent; }
@property --zd-b { syntax: "<color>"; inherits: false; initial-value: transparent; }
@property --zd-c { syntax: "<color>"; inherits: false; initial-value: transparent; }
.zendro .themebtn .dot { --zd-a: var(--dot-a); --zd-b: var(--dot-b); --zd-c: var(--dot-c); position: relative; z-index: 2; width: 18px; height: 18px; border-radius: 50%;
  background: conic-gradient(var(--zd-a) 0 50%, var(--zd-b) 50% 62%, var(--zd-c) 62% 100%);
  box-shadow: 0 0 0 1px rgba(var(--g),.6), 0 0 10px rgba(var(--g),.45);
  transition: transform .6s cubic-bezier(.3,1.3,.5,1), --zd-a .6s, --zd-b .6s, --zd-c .6s, box-shadow .6s; }

/* the welcome */
.zendro .splash { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; padding: 24px; background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,.78), rgba(0,0,0,.9) 70%); transition: opacity .5s ease, visibility 0s .5s; }
.zendro .splash.gone { opacity: 0; visibility: hidden; }
/* a panel of its own: dark glass, a stronger blur, the list's chasing border */
.zendro .sp-in { position: relative; padding: 34px clamp(20px, 4cqw, 48px) 30px; border-radius: 3px; background: rgba(6,5,3,.78) !important; -webkit-backdrop-filter: blur(8px) saturate(.7); backdrop-filter: blur(8px) saturate(.7); max-width: min(860px, 100%); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 14px; animation: zd-rise .9s cubic-bezier(.2,.8,.2,1) both; }
.zendro .sp-in > * { position: relative; z-index: 2; }
.zendro .sp-kicker { font-size: 10.5px; letter-spacing: .32em; color: var(--gold-dim); }
.zendro .splash h1 { margin: 0; font: 400 min(40px, 3.5cqw)/1.05 var(--display); letter-spacing: .14em; color: var(--gold); text-shadow: 0 0 24px rgba(var(--g),.45); white-space: nowrap; }
.zendro .splash p { margin: 0; max-width: 58ch; font-size: 13px; line-height: 1.7; color: var(--gold-hi); }
.zendro .splash .begin { margin-top: 10px; padding: 12px 18px; font-size: 11.5px; }
@keyframes zd-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

/* the guide */
.zendro .help { position: absolute; z-index: 11; left: 50%; top: 50%; width: min(620px, calc(100% - 32px)); max-height: calc(100% - 60px); display: flex; flex-direction: column; border-radius: 3px; transform: translate(-50%, -50%) scale(.96); opacity: 0; visibility: hidden; transition: transform .14s cubic-bezier(.2,.9,.2,1), opacity .14s, visibility 0s .14s; }
.zendro .help.on { transform: translate(-50%, -50%); opacity: 1; visibility: visible; transition: transform .16s cubic-bezier(.2,.9,.2,1), opacity .16s; }
.zendro .help .scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 18px 18px; position: relative; z-index: 2; scrollbar-color: var(--gold) rgba(var(--g),.08); }
.zendro .help dl { margin: 0; display: grid; grid-template-columns: minmax(130px, max-content) minmax(0, 1fr); gap: 9px 18px; font-size: 12px; }
.zendro .help dt { color: var(--gold-hi); letter-spacing: .14em; font-size: 10.5px; display: flex; align-items: center; gap: 7px; padding-top: 2px; }
.zendro .help dt svg { width: 14px; height: 14px; }
.zendro .help dd { margin: 0; color: var(--gold); line-height: 1.55; }
.zendro .help dd b { color: var(--gold-hi); font-weight: 500; letter-spacing: .08em; }
@container (max-width: 560px) { .zendro .help dl { grid-template-columns: 1fr; gap: 2px; } .zendro .help dd { margin-bottom: 8px; } }

@media (prefers-reduced-motion: reduce) { .zendro .sheen::before, .zendro .btn.glow, .zendro .zd-scan { animation: none !important; } }
`;
