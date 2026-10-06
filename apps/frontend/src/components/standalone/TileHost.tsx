'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowStore } from '@/store/windowStore';
import { useExplorerStore } from '@/store/explorerStore';
import { WindowErrorBoundary } from '@/components/Window/WindowErrorBoundary';
import { APP_REGISTRY, type AppConfig } from '@/config/appRegistry';
import { StandaloneHeader, useStandaloneActions, scaleVars, CONTENT_MIN_PX } from './StandaloneShell';
import { useStandaloneTheme, useFontStep } from './standaloneTheme';
import { StandaloneFooter } from './StandaloneFooter';
import { StandalonePresence } from './StandalonePresence';
import {
  tileLayout, rowsFor, MIN_WEIGHT, MAX_WEIGHT,
  type Rect, type Gutter, type TileWeights,
} from './tileLayout';

const PANE_TITLEBAR_PX = 34;

interface DragState {
  id: string;
  /** Pointer offset within the pane, so it doesn't jump to the cursor. */
  grabX: number;
  grabY: number;
  x: number;
  y: number;
  /** Size frozen at grab time. Slots differ in size between rows (a 3-wide row
   *  vs a 2-wide one), so letting the dragged pane adopt its preview slot's
   *  size mid-flight invalidated grabX/grabY and made vertical and diagonal
   *  drags lurch and stick. */
  w: number;
  h: number;
  /** Slot the pane will land in on release. */
  dropIndex: number;
  /** Set once the pointer has moved far enough to count as a drag, not a click. */
  moved: boolean;
}

interface ResizeState {
  gutter: Gutter;
  startX: number;
  startY: number;
  /** Weights captured at grab time, so the drag is absolute rather than cumulative. */
  base: TileWeights;
  cellPx: number;
}

const DRAG_THRESHOLD_PX = 4;

/**
 * Pane sizes as a URL-safe string: `rows~row0cols;row1cols`, each a comma list
 * of weights. Rounded to 2dp - more precision than that is noise in a shared link.
 *
 *   1.2,0.8~1.5,0.5;1,1
 */
function encodeWeights(w: TileWeights): string {
  const n = (x: number) => Math.round(x * 100) / 100;
  const rows = (w.rows ?? []).map(n).join(',');
  const cols = (w.cols ?? []).map((r) => (r ?? []).map(n).join(',')).join(';');
  if (!rows && !cols) return '';
  return `${rows}~${cols}`;
}

function decodeWeights(raw: string | null): TileWeights {
  if (!raw) return {};
  const [rowPart = '', colPart = ''] = raw.split('~');
  const nums = (s: string) =>
    s.split(',').map(Number).filter((v) => Number.isFinite(v) && v > 0);
  const rows = nums(rowPart);
  // Drop rows that parsed to nothing, so garbage in the param can't leave empty
  // arrays behind for the layout to trip over.
  const cols = (colPart ? colPart.split(';').map(nums) : []).filter((r) => r.length > 0);
  const out: TileWeights = {};
  if (rows.length) out.rows = rows;
  if (cols.length) out.cols = cols;
  return out;
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Standalone host for apps that spawn sibling windows (Explorer's hash clicks).
 *
 * Renders `windowStore.windows` as an auto-tiling grid instead of draggable Rnd
 * frames. The apps are untouched - they still call openWindow/updateWindow/
 * closeWindow as they do on the desktop, so any window-spawning app gets tiling
 * for free.
 */
export function TileHost({ config }: { config: AppConfig }) {
  const windows = useWindowStore((s) => s.windows);
  const activeWindowId = useWindowStore((s) => s.activeWindowId);
  const openWindow = useWindowStore((s) => s.openWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const views = useExplorerStore((s) => s.views);

  const { mode, toggle } = useStandaloneTheme();
  const { step, scale, setStep } = useFontStep();
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [animate, setAnimate] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const [order, setOrder] = useState<string[]>([]);
  const [weights, setWeights] = useState<TileWeights>(() =>
    typeof window === 'undefined'
      ? {}
      : decodeWeights(new URLSearchParams(window.location.search).get('w'))
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  // Mirror of `drag` for the pointerup handler. Committing the reorder from
  // inside a setDrag updater is a nested state update, which React is free to
  // discard - that's why a released pane snapped back to where it started.
  const dragRef = useRef<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);

  const rootWindowId = `standalone-${config.id}`;

  // ── Seed panes from the URL ────────────────────────────────────────────────
  // `?q=` may repeat, one per pane, with a parallel `?type=`. This is what makes
  // "copy link" reproduce a multi-pane arrangement.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Keep empty entries: they are placeholders for panes with nothing loaded,
    // and dropping them would collapse the shared layout.
    const qs = params.getAll('q').map((v) => v.trim());
    const types = params.getAll('type');
    const store = useWindowStore.getState();
    const ex = useExplorerStore.getState();

    store.closeAll();

    const seeds = qs.length ? qs : [''];
    seeds.forEach((q, i) => {
      const id = i === 0 ? rootWindowId : `${rootWindowId}-${i}`;
      if (q) {
        ex.queueSearch(id, q, (types[i] ?? 'auto') as 'block' | 'transaction' | 't-address' | 'z-address' | 'auto');
      }
      store.openWindow({
        id,
        type: config.type,
        title: config.title,
        position: { x: 0, y: 0 },
        size: config.defaultSize,
        minSize: config.minSize,
      });
    });

    return () => useWindowStore.getState().closeAll();
  }, [rootWindowId, config.type, config.title, config.defaultSize, config.minSize, resetKey]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const raf = requestAnimationFrame(() => setAnimate(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const live = useMemo(() => windows.filter((w) => !w.minimized), [windows]);

  useEffect(() => {
    setOrder((prev) => {
      const ids = live.map((w) => w.id);
      const kept = prev.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !kept.includes(id));
      return kept.length === prev.length && added.length === 0 ? prev : [...kept, ...added];
    });
  }, [live]);

  const baseOrder = useMemo(
    () => order.filter((id) => live.some((w) => w.id === id)),
    [order, live]
  );

  // While dragging, the layout previews the drop without mutating `order` - the
  // committed order only changes on release. Reordering mid-drag fed the new
  // rects straight back into the hit-test, which made the pane thrash and made
  // it hard to let go anywhere.
  const previewOrder = useMemo(() => {
    if (!drag) return baseOrder;
    const from = baseOrder.indexOf(drag.id);
    return moveItem(baseOrder, from, drag.dropIndex);
  }, [baseOrder, drag]);

  const panes = useMemo(
    () =>
      previewOrder
        .map((id) => live.find((w) => w.id === id))
        .filter((w): w is NonNullable<typeof w> => Boolean(w)),
    [previewOrder, live]
  );

  const { rects, contentHeight, gutters } = tileLayout(panes.length, box.width, box.height, 10, weights);

  // ── URL reflects the panes ────────────────────────────────────────────────
  // EVERY pane gets a q/type pair, in order - including ones with nothing loaded
  // yet, which emit an empty q. Skipping them lost both the pane count and the
  // positions of the ones that followed, so a shared link rebuilt the wrong
  // layout. An empty q reopens an empty pane in the right slot.
  useEffect(() => {
    // The q/type pairs describe Explorer panes. Any other tiled app (ZIM) owns
    // its own URL - rewriting it would drop its params, like ZIM's ?add=.
    if (!baseOrder.length || config.id !== 'explorer') return;
    const params = new URLSearchParams();
    let anyLoaded = false;
    for (const id of baseOrder) {
      const v = views[id];
      params.append('q', v?.query ?? '');
      params.append('type', v?.type ?? 'auto');
      if (v?.query) anyLoaded = true;
    }
    // Pane sizes too, so a resized arrangement survives being shared.
    const w = encodeWeights(weights);
    if (w) params.set('w', w);
    // A lone empty pane is just the default view - keep that URL clean.
    const qs = anyLoaded || baseOrder.length > 1 || w ? `?${params.toString()}` : '';
    const next = `${window.location.pathname}${qs}`;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [baseOrder, views, weights, config.id]);

  /**
   * Slot index for a point, hit-tested from the POINTER (stable) rather than the
   * moving pane's centre. Falls back to the nearest slot centre when the pointer
   * is over a gap or gutter - strict containment returned -1 there, which froze
   * dropIndex mid-gesture and made crossing rows feel blocked.
   */
  const slotAt = useCallback((x: number, y: number, all: Rect[]) => {
    if (!all.length) return -1;
    const inside = all.findIndex(
      (r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
    );
    if (inside >= 0) return inside;
    let best = 0;
    let bestD = Infinity;
    all.forEach((r, i) => {
      const dx = x - (r.x + r.width / 2);
      const dy = y - (r.y + r.height / 2);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }, []);

  const pointIn = useCallback((e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top + el.scrollTop };
  }, []);

  // ── Pane drag ─────────────────────────────────────────────────────────────
  const onPaneGrab = useCallback(
    (e: React.PointerEvent, id: string, rect: Rect, index: number) => {
      if ((e.target as HTMLElement).closest('button,a,input,select,textarea')) return;
      e.preventDefault();
      const p = pointIn(e);
      if (!p) return;
      focusWindow(id);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const next: DragState = {
        id,
        grabX: p.x - rect.x,
        grabY: p.y - rect.y,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        dropIndex: index,
        moved: false,
      };
      dragRef.current = next;
      setDrag(next);
    },
    [focusWindow, pointIn]
  );

  const onPaneDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const p = pointIn(e);
      if (!p) return;
      const nx = p.x - drag.grabX;
      const ny = p.y - drag.grabY;
      const moved =
        drag.moved ||
        Math.abs(nx - drag.x) > DRAG_THRESHOLD_PX ||
        Math.abs(ny - drag.y) > DRAG_THRESHOLD_PX;

      const hit = slotAt(p.x, p.y, rects);
      const next: DragState = {
        ...(dragRef.current ?? drag),
        x: nx,
        y: ny,
        moved,
        dropIndex: hit >= 0 ? hit : drag.dropIndex,
      };
      dragRef.current = next;
      setDrag(next);
    },
    [drag, pointIn, rects, slotAt]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
      const d = dragRef.current;
      dragRef.current = null;
      // Commit first, THEN clear - so the pane never renders at its old slot.
      if (d && d.moved) {
        const from = baseOrder.indexOf(d.id);
        if (from >= 0 && from !== d.dropIndex) setOrder(moveItem(baseOrder, from, d.dropIndex));
      }
      setDrag(null);
    },
    [baseOrder]
  );

  // ── Gutter resize ─────────────────────────────────────────────────────────
  const onGutterGrab = useCallback(
    (e: React.PointerEvent, g: Gutter) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const rows = rowsFor(panes.length);
      const cellPx =
        g.kind === 'col' ? box.width / (rows[g.row] || 1) : box.height / (rows.length || 1);
      setResize({
        gutter: g,
        startX: e.clientX,
        startY: e.clientY,
        base: { rows: [...(weights.rows ?? [])], cols: (weights.cols ?? []).map((r) => [...(r ?? [])]) },
        cellPx: Math.max(1, cellPx),
      });
    },
    [box.width, box.height, panes.length, weights]
  );

  const onGutterDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!resize) return;
      const { gutter: g, base, cellPx } = resize;
      const rows = rowsFor(panes.length);
      const delta = (g.kind === 'col' ? e.clientX - resize.startX : e.clientY - resize.startY) / cellPx;
      const clamp = (v: number) => Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, v));

      if (g.kind === 'col') {
        const cols = (base.cols ?? []).map((r) => [...(r ?? [])]);
        const n = rows[g.row] || 1;
        const rowArr = Array.from({ length: n }, (_, i) => cols[g.row]?.[i] ?? 1);
        const a = clamp(rowArr[g.index] + delta);
        const b = clamp(rowArr[g.index + 1] - delta);
        rowArr[g.index] = a;
        rowArr[g.index + 1] = b;
        cols[g.row] = rowArr;
        setWeights((w) => ({ ...w, cols }));
      } else {
        const rowArr = Array.from({ length: rows.length }, (_, i) => base.rows?.[i] ?? 1);
        rowArr[g.index] = clamp(rowArr[g.index] + delta);
        if (g.index + 1 < rowArr.length) rowArr[g.index + 1] = clamp(rowArr[g.index + 1] - delta);
        setWeights((w) => ({ ...w, rows: rowArr }));
      }
    },
    [resize, panes.length]
  );

  const endResize = useCallback((e: React.PointerEvent) => {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    setResize(null);
  }, []);

  const actions = useStandaloneActions({
    onResetApp: () => {
      setOrder([]);
      setWeights({});
      setResetKey((k) => k + 1);
    },
    extra: [
      {
        label: 'Reset layout',
        hint: 'Even sizes, ordered by most recently focused',
        icon: '▦',
        disabled: panes.length < 2,
        onSelect: () => {
          setWeights({});
          setOrder([...live].sort((a, b) => b.zIndex - a.zIndex).map((w) => w.id));
        },
      },
      {
        label: 'Close other panes',
        hint: 'Keep only the focused pane',
        icon: '✕',
        disabled: panes.length < 2,
        onSelect: () => {
          const keep = activeWindowId ?? panes[0]?.id;
          panes.forEach((w) => { if (w.id !== keep) closeWindow(w.id); });
          setWeights({});
        },
      },
    ],
  });

  return (
    <div
      className="standalone-root flex h-dvh w-screen flex-col overflow-y-auto"
      style={{ background: 'var(--bg-desktop)', ...scaleVars(scale) }}
    >
      <StandaloneHeader
        title={panes.length > 1 ? `${config.title} · ${panes.length} panes` : config.title}
        appId={config.id}
        icon={config.icon}
        mode={mode}
        onToggleTheme={toggle}
        fontStep={step}
        onFontStep={setStep}
        actions={actions}
      />

      <div
        ref={boxRef}
        className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 pb-1 sm:px-3"
        style={{ minHeight: CONTENT_MIN_PX }}
      >
        <div style={{ height: Math.max(contentHeight, box.height) }} />

        {/* Drop hint for the slot the dragged pane will land in. */}
        {drag?.moved && rects[drag.dropIndex] && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 left-0"
            style={{
              width: rects[drag.dropIndex].width,
              height: rects[drag.dropIndex].height,
              transform: `translate(${rects[drag.dropIndex].x}px, ${rects[drag.dropIndex].y}px)`,
              borderRadius: 'var(--md-shape-md)',
              background: 'color-mix(in srgb, var(--accent-gold) 10%, transparent)',
              outline: '2px dashed color-mix(in srgb, var(--accent-gold) 45%, transparent)',
              outlineOffset: -2,
              transition: 'transform 200ms var(--md-ease-emphasized), width 200ms var(--md-ease-emphasized), height 200ms var(--md-ease-emphasized)',
              zIndex: 5,
            }}
          />
        )}

        {/* Resize gutters */}
        {!drag && gutters.map((g) => (
          <div
            key={`${g.kind}-${g.row}-${g.index}`}
            onPointerDown={(e) => onGutterGrab(e, g)}
            onPointerMove={onGutterDrag}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute top-0 left-0 group"
            style={{
              width: g.width,
              height: g.height,
              transform: `translate(${g.x}px, ${g.y}px)`,
              cursor: g.kind === 'col' ? 'col-resize' : 'row-resize',
              touchAction: 'none',
              zIndex: 25,
            }}
            title="Drag to resize"
          >
            <span
              aria-hidden
              className="block h-full w-full opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              style={{
                background: 'var(--accent-gold)',
                borderRadius: 'var(--md-shape-full)',
                opacity: resize?.gutter === g ? 1 : undefined,
              }}
            />
          </div>
        ))}

        {panes.map((win, i) => {
          const rect = rects[i];
          if (!rect || box.width === 0) return null;
          const app = APP_REGISTRY.find((a) => a.type === win.type);
          if (!app?.component) return null;
          const AppComponent = app.component as React.ComponentType<{ windowId?: string }>;
          const isActive = win.id === activeWindowId;
          const isDragging = drag?.id === win.id && drag.moved;

          const x = isDragging ? drag.x : rect.x;
          const y = isDragging ? drag.y : rect.y;

          return (
            <div
              key={win.id}
              className="absolute top-0 left-0 flex flex-col overflow-hidden"
              style={{
                width: isDragging ? drag.w : rect.width,
                height: isDragging ? drag.h : rect.height,
                transform: `translate(${x}px, ${y}px)${isDragging ? ' scale(1.015)' : ''}`,
                opacity: isDragging ? 0.92 : 1,
                zIndex: isDragging ? 30 : isActive ? 20 : 10,
                background: 'var(--bg-window)',
                borderRadius: 'var(--md-shape-md)',
                // Focus reads as a ring following the card's curve. An inset
                // box-shadow rather than a border so it never shifts layout.
                boxShadow: [
                  isActive ? 'inset 0 0 0 2px var(--accent-gold)' : null,
                  isDragging ? 'var(--md-elev-3)' : isActive ? 'var(--md-elev-2)' : 'var(--md-elev-1)',
                ].filter(Boolean).join(', '),
                // The dragged pane follows the pointer 1:1 (no easing, or it
                // lags and feels sticky); everything else glides.
                transition: isDragging
                  ? 'box-shadow var(--md-dur-short) var(--md-ease-standard)'
                  : animate
                    ? 'transform 260ms var(--md-ease-emphasized), width 260ms var(--md-ease-emphasized), height 260ms var(--md-ease-emphasized), box-shadow var(--md-dur-short) var(--md-ease-standard)'
                    : undefined,
              }}
            >
              <div
                className="relative flex shrink-0 items-center justify-between gap-2 px-3"
                onPointerDown={(e) => onPaneGrab(e, win.id, rect, i)}
                onPointerMove={onPaneDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{
                  height: PANE_TITLEBAR_PX,
                  // Lifted well clear of the card body - this is the grab handle,
                  // so it should be the most obvious thing on the pane.
                  background: isActive ? 'var(--pane-bar-active)' : 'var(--pane-bar)',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  touchAction: 'none',
                  transition: 'background var(--md-dur-short) var(--md-ease-standard)',
                }}
                title="Drag to rearrange"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <GripIcon />
                  <span
                    className="md-body-sm truncate"
                    style={{
                      color: isActive ? 'var(--accent-gold)' : 'var(--text-primary)',
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    {win.title}
                  </span>
                </span>
                {panes.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeWindow(win.id);
                    }}
                    aria-label={`Close ${win.title}`}
                    className="md-state flex shrink-0 items-center justify-center"
                    style={{
                      width: 24, height: 24,
                      borderRadius: 'var(--md-shape-full)',
                      color: 'var(--text-muted)',
                      fontSize: 12, lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <div className="h-full w-full overflow-auto p-2">
                  <WindowErrorBoundary title={win.title}>
                    <AppComponent windowId={win.id} />
                  </WindowErrorBoundary>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <StandaloneFooter />
      <StandalonePresence />
    </div>
  );
}

function GripIcon() {
  return (
    <svg
      width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden
      style={{ color: 'var(--text-muted)', opacity: 0.55, flexShrink: 0 }}
    >
      <circle cx="2.5" cy="3" r="1.1" /><circle cx="7.5" cy="3" r="1.1" />
      <circle cx="2.5" cy="7" r="1.1" /><circle cx="7.5" cy="7" r="1.1" />
      <circle cx="2.5" cy="11" r="1.1" /><circle cx="7.5" cy="11" r="1.1" />
    </svg>
  );
}
