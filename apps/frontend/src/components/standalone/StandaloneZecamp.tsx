'use client';

import { useWindowStore } from '@/store/windowStore';
import { APP_REGISTRY } from '@/config/appRegistry';
import { ZECAMP_APP } from '@/lib/zecamp/engine';
import { WindowErrorBoundary } from '@/components/Window/WindowErrorBoundary';
import ZecampStrip from '@/components/apps/media/ZecampStrip';
import { FOOTER_PX } from './StandaloneFooter';

/**
 * zecAmp on a standalone page (opened by an app that wants music, like
 * Zeometry's ♫). There is no desktop, so it floats bottom-right over the app;
 * minimised, it shrinks to the transport strip. Closing it ends the music, as
 * on the desktop.
 */
export function StandaloneZecamp() {
  const win = useWindowStore((s) => s.windows.find((w) => w.type === ZECAMP_APP));
  if (!win) return null;
  const { minimizeWindow, closeWindow } = useWindowStore.getState();
  const Player = APP_REGISTRY.find((a) => a.type === ZECAMP_APP)?.component as React.ComponentType | undefined;
  const frame: React.CSSProperties = { position: 'fixed', right: 12, bottom: FOOTER_PX + 8, zIndex: 60, background: 'var(--bg-window)', borderRadius: 'var(--md-shape-md)', boxShadow: 'var(--md-elev-3)', overflow: 'hidden' };
  if (win.minimized) {
    return <div style={{ ...frame, height: 30, width: 'min(440px, calc(100vw - 24px))', display: 'flex' }}><ZecampStrip /></div>;
  }
  const bar = 'flex h-6 w-6 items-center justify-center rounded-full text-[12px] text-[var(--text-muted)] hover:text-[var(--accent-gold)]';
  return (
    <div style={{ ...frame, width: 'min(412px, calc(100vw - 24px))', height: `min(700px, calc(100dvh - ${FOOTER_PX + 90}px))`, display: 'flex', flexDirection: 'column' }}>
      <div className="flex h-[30px] shrink-0 items-center justify-between px-2" style={{ background: 'var(--pane-bar-active)' }}>
        <span className="md-body-sm font-semibold text-[var(--accent-gold)]">{win.title}</span>
        <span className="flex gap-1">
          <button type="button" className={bar} onClick={() => minimizeWindow(win.id)} title="Minimise (keeps playing)" aria-label="Minimise zecAmp">—</button>
          <button type="button" className={bar} onClick={() => closeWindow(win.id)} title="Close (stops the music)" aria-label="Close zecAmp">✕</button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <WindowErrorBoundary title={win.title}>{Player && <Player />}</WindowErrorBoundary>
      </div>
    </div>
  );
}
