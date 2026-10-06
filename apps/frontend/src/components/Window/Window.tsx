'use client';

import { BetaTag } from '@/components/beta/Beta';
import { useRef, useState, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import { useWindowStore } from '@/store/windowStore';
import { useSound } from '@/hooks/useSound';
import { useIsMobile } from '@/hooks/useIsMobile';
import { APP_META, getStandaloneMode } from '@/config/appMeta';
import { useWorkArea } from '@/utils/workArea';
import { TitleBarSlot } from './titleBarSlot';

interface WindowProps {
  id: string;
  children: React.ReactNode;
}

export function Window({ id, children }: WindowProps) {
  const {
    windows,
    activeWindowId,
    focusWindow,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    restoreWindow,
    updatePosition,
    updateSize,
    updateWindow,
  } = useWindowStore();

  const { playClick, playClose, playMinimize } = useSound();
  const mobile = useIsMobile();
  const windowState = windows.find(w => w.id === id);
  const onTestnet = windowState?.network === 'testnet';
  const rndRef = useRef<Rnd>(null);
  // Hook, so a window re-lays-out when the band moves (ticker shown/hidden,
  // taskbar swapped, viewport resized) - not just when its own state changes.
  const workArea = useWorkArea();

  // Flash message when window is raised from already-open state
  const [flashVisible, setFlashVisible] = useState(false);
  const [flashText, setFlashText] = useState('');
  useEffect(() => {
    if (windowState?.flashMessage) {
      setFlashText(windowState.flashMessage);
      setFlashVisible(true);
      const t = setTimeout(() => {
        setFlashVisible(false);
        updateWindow(id, { flashMessage: undefined });
      }, 2600);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowState?.flashMessage]);

  if (!windowState) {
    return null;
  }

  /*
   * A minimized window is HIDDEN, not unmounted.
   *
   * Unmounting threw away everything the app was holding - Pools' mode and the
   * piece on screen, the Explorer's search and result - so minimizing was
   * indistinguishable from closing and reopening. `display:none` keeps the tree
   * (and every bit of component state in it) alive while taking it out of the
   * layout entirely.
   */
  const hidden = windowState.minimized || windowState.parked;

  const isActive = activeWindowId === id;
  const { position, size, zIndex, title, maximized, minSize } = windowState;

  const handleMouseDown = () => {
    if (!isActive) {
      focusWindow(id);
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    playClose();
    closeWindow(id);
  };

  const handleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    playMinimize();
    minimizeWindow(id);
  };

  const handleMaximize = (e: React.MouseEvent) => {
    e.stopPropagation();
    playClick();
    if (maximized) {
      restoreWindow(id);
    } else {
      maximizeWindow(id);
    }
  };

  // On mobile every window fills the screen and stacks (no free drag/resize).
  // Otherwise the frame is capped to the viewport so it can never exceed it.
  const fullscreen = maximized || mobile;
  // The work area, NOT the viewport: the taskbar and the block ticker are both
  // carved out of the desktop container this lives in, and a window measured
  // against the viewport hangs past the bottom of it - where the container
  // clips it away along with whatever the app anchors down there.
  const { width: availW, height: availH } = workArea;
  const displaySize = fullscreen
    ? { width: availW, height: availH }
    : { width: Math.min(size.width, availW), height: Math.min(size.height, availH) };
  // Windows live inside the desktop layer, which is already inset below a top
  // taskbar - so y=0 is flush with the top of that area. Don't re-add the
  // taskbar height (that produced a forced gap at the top).
  //
  // Clamped so the WHOLE frame stays in the band: titlebar (with its close and
  // minimize buttons) at the top, bottom edge above the footer strip.
  const displayPosition = fullscreen
    ? { x: 0, y: 0 }
    : {
        x: Math.max(0, Math.min(position.x, availW - displaySize.width)),
        y: Math.max(0, Math.min(position.y, availH - displaySize.height)),
      };

  // Fixed-grid *terminal* apps (ASCII character UIs, canvas games) can't reflow -
  // render them at their design width and `zoom` to fit. Deterministic: no
  // measurement. Everything else reflows responsively. `zoom` (not transform) so
  // it doesn't break position:fixed descendants.
  const SCALE_APPS = new Set(['bbs-rpg']);
  const scaleFit = mobile && SCALE_APPS.has(windowState.type);
  const designWidth = size.width || 600;
  const stageScale = scaleFit ? Math.min(1, (availW - 16) / designWidth) : 1;
  const TITLEBAR_PX = 40; // --titlebar-height on mobile
  const stageHeight = scaleFit ? (availH - TITLEBAR_PX) / stageScale : undefined;

  // Pop-out target, only for apps that actually have a standalone route
  // (folders, the ticker placeholder and sysop apps deliberately don't).
  const meta = APP_META.find((a) => a.id === windowState.type);
  const standaloneHref = meta && getStandaloneMode(meta) ? `/${meta.id}` : null;

  return (
    <Rnd
      ref={rndRef}
      position={displayPosition}
      size={displaySize}
      minWidth={fullscreen ? 0 : (minSize?.width || 150)}
      minHeight={fullscreen ? 0 : (minSize?.height || 100)}
      disableDragging={fullscreen}
      enableResizing={!fullscreen}
      onDragStop={(e, d) => {
        updatePosition(id, { x: d.x, y: d.y });
      }}
      onResizeStop={(e, direction, ref, delta, position) => {
        updateSize(id, {
          width: parseInt(ref.style.width),
          height: parseInt(ref.style.height),
        });
        updatePosition(id, position);
      }}
      onMouseDown={handleMouseDown}
      // Spread rather than a ternary: react-rnd's own `display: inline-block`
      // is merged UNDER this, and writing `display: undefined` would clobber it.
      style={{ zIndex, pointerEvents: 'auto', ...(hidden ? { display: 'none' } : {}) }}
      dragHandleClassName="window-drag-handle"
      bounds="parent"
    >
      <div
        data-window-id={id}
        className={`
          h-full w-full flex flex-col
          bg-[var(--bg-window)]
          window-border
          overflow-hidden
          ${isActive ? 'window-active' : ''}
          relative
        `}
        /*
         * A testnet window wears a warm border, whatever the theme says.
         *
         * Deliberately outside the palette: every theme is free to be calm, and
         * "you are looking at a test chain, none of this is real" must not be
         * something a theme can make subtle. The colour is fixed for the same
         * reason the token warning is.
         */
        /*
         * `!important` because .window-border.window-active sets a gold
         * border-color, and the FOCUSED window is exactly the one most likely
         * to be showing testnet - so the one place the warning matters most is
         * the one place the theme would quietly overrule it.
         */
        ref={(el) => {
          if (!el) return;
          if (onTestnet) {
            el.style.setProperty('border-color', '#ff6b35', 'important');
            el.style.setProperty('box-shadow', '0 0 0 1px #ff6b3577, 0 6px 22px rgba(0,0,0,.55)', 'important');
          } else {
            el.style.removeProperty('border-color');
            el.style.removeProperty('box-shadow');
          }
        }}
      >
        {/* Title Bar */}
        <div
          className={`
            window-drag-handle titlebar
            flex items-center justify-between
            px-2 py-1
            cursor-move select-none
            ${!isActive ? 'inactive' : ''}
          `}
          style={{ height: 'var(--titlebar-height)' }}
        >
          <span className="flex items-center min-w-0 gap-2">
            <span
              className="truncate min-w-0 text-[var(--accent-gold)]"
              style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-title)' }}
            >
              {title}
            </span>
            {/* Stamped at open time and never revised: this window's contents
                came from a test chain and still do, whatever the toggle says
                now. */}
            {onTestnet && (
              <span
                title="This window is showing TESTNET data. Values here are not real, and it will keep showing testnet even if you switch back."
                style={{
                  flexShrink: 0, fontFamily: 'var(--font-mono, monospace)', fontSize: 9.5,
                  fontWeight: 800, letterSpacing: '.8px', lineHeight: 1.6,
                  padding: '0 5px', borderRadius: 3, cursor: 'help',
                  background: '#ff6b3522', color: '#ff8a5c',
                  borderWidth: 1, borderStyle: 'solid', borderColor: '#ff6b3577',
                }}
              >TESTNET</span>
            )}
            {/* Beta apps carry the tag whether or not they are switched live. */}
            {meta?.beta && <BetaTag />}
            {/* Whatever the app wants in the chrome. The titlebar is also the
                drag handle, so anything landing here must not start a drag. */}
            <TitleBarSlot
              windowId={id}
              style={{ marginLeft: 2 }}
            />
            {/* Kaze's help videos for this app, when a sysop has switched any on. */}
            {standaloneHref && (
              <a
                href={standaloneHref}
                target="_blank"
                rel="noopener noreferrer"
                // The titlebar is the drag handle; without this a click-drag
                // starting on the icon would move the window instead.
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 flex items-center justify-center opacity-55 hover:opacity-100 transition-opacity cursor-pointer text-[var(--accent-gold)]"
                style={{ width: 15, height: 15 }}
                title={`Open ${title} in its own tab`}
                aria-label={`Open ${title} in its own tab`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 4h6v6" />
                  <path d="M20 4l-8.5 8.5" />
                  <path d="M19 14.5V19a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 013 19V6a1.5 1.5 0 011.5-1.5H9" />
                </svg>
              </a>
            )}
          </span>

          <div className="flex gap-1 shrink-0">
            {/* Minimize */}
            <button
              onClick={handleMinimize}
              data-window-btn="minimize"
              className="btn-window w-5 h-5 flex items-center justify-center"
              style={{ fontSize: 'var(--font-size-button)' }}
              title="Minimize"
            >
              _
            </button>
            {/* Maximize */}
            <button
              onClick={handleMaximize}
              className="btn-window w-5 h-5 flex items-center justify-center"
              style={{ fontSize: 'var(--font-size-button)' }}
              title={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? '◱' : '□'}
            </button>
            {/* Close */}
            <button
              onClick={handleClose}
              data-window-btn="close"
              className="btn-window w-5 h-5 flex items-center justify-center text-[var(--accent-orange)]"
              style={{ fontSize: 'var(--font-size-button)' }}
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Flash message - shown when window is already open and gets re-raised */}
        {flashText && (
          <div
            className="absolute top-9 left-2 z-[9999] pointer-events-none font-mono text-[10px] px-2.5 py-1 border border-[var(--accent-gold)]/60 bg-[var(--bg-window)] text-[var(--accent-gold)]"
            style={{ opacity: flashVisible ? 1 : 0, transition: 'opacity 0.6s ease' }}
          >
            {flashText}
          </div>
        )}

        {/* Content - reflow apps render at window width; scale apps render at their
            design width and zoom-to-fit (terminals/games). */}
        <div className={`flex-1 min-w-0 overflow-auto window-content ${scaleFit ? 'p-0' : mobile ? 'p-2' : 'p-4'}`}>
          {scaleFit ? (
            <div style={{ width: designWidth, height: stageHeight, zoom: stageScale } as React.CSSProperties}>
              {children}
            </div>
          ) : children}
        </div>
      </div>
    </Rnd>
  );
}
