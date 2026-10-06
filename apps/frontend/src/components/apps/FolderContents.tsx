'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTitleBarSlot } from '@/components/Window/titleBarSlot';
import { BetaTag } from '@/components/beta/Beta';
import { useFolderView, useFolderViewStore, type FolderView, type IconSize } from '@/store/folderViewStore';
import { AppGlyph } from '@/components/ui/ZecIcon';
import { useWindowStore } from '@/store/windowStore';
import { useIsAdmin, useIsSudobud } from '@/store/authStore';
import { adminAppVisible } from '@/config/appMeta';
import { useSettingsStore } from '@/store/settingsStore';
import { useTickerStore } from '@/store/tickerStore';
import { useSound } from '@/hooks/useSound';
import { useIsMobile } from '@/hooks/useIsMobile';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { APP_REGISTRY, AppConfig } from '@/components/Desktop/Desktop';
import type { AppCategory } from '@/config/appMeta';

interface FolderContentsProps {
  /* Taken from the registry's own union rather than restated - a duplicated
     list is how 'rings' existed everywhere except here. */
  category: AppCategory;
  windowId?: string;
}

const ICON_PX: Record<IconSize, number> = { sm: 26, md: 36, lg: 48 };
const COLS: Record<IconSize, string> = { sm: 'grid-cols-3 sm:grid-cols-4', md: 'grid-cols-2 sm:grid-cols-3', lg: 'grid-cols-2' };

/** The "View" menu: lives in the window's title bar, opens over everything. */
function ViewMenu({ folder, view }: { folder: string; view: FolderView }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const set = useFolderViewStore((s) => s.set);
  const reset = useFolderViewStore((s) => s.reset);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setAt({ x: Math.min(r.left, window.innerWidth - 200), y: r.bottom + 4 });
    setOpen((o) => !o);
  };
  const row = (label: string, on: boolean, act: () => void, disabled = false) => (
    <button key={label} onClick={act} disabled={disabled}
      className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--accent-gold)]/20 disabled:opacity-40 disabled:hover:bg-transparent text-[var(--text-primary)]">
      <span className="w-3 text-[var(--accent-gold)]">{on ? '✓' : ''}</span>{label}
    </button>
  );
  const head = (t: string) => <div className="px-3 pt-2 pb-0.5 text-[var(--text-muted)] uppercase" style={{ fontSize: '0.8em', letterSpacing: '.06em' }}>{t}</div>;

  return (
    <>
      <button ref={btn} onClick={toggle} title="Change how this folder shows its apps"
        className="px-1.5 leading-none text-[var(--text-secondary)] hover:text-[var(--accent-gold)]"
        style={{ fontSize: 'calc(var(--font-size-label) * 0.6)', color: open ? 'var(--accent-gold)' : undefined }}>
        View ▾
      </button>
      {open && createPortal(
        <div ref={panel} className="fixed bg-[#1a1a2e] window-border min-w-44 py-1 z-[99999]"
          style={{ left: at.x, top: at.y, fontSize: 'var(--font-size-menu)' }}>
          {head('Show as')}
          {row('Icons', view.mode === 'icons', () => set(folder, { mode: 'icons' }))}
          {row('List', view.mode === 'list', () => set(folder, { mode: 'list' }))}
          {head('Sort')}
          {row('A to Z', view.sort === 'az', () => set(folder, { sort: 'az' }))}
          {row('Z to A', view.sort === 'za', () => set(folder, { sort: 'za' }))}
          {row('Beta apps last', view.betaLast, () => set(folder, { betaLast: !view.betaLast }))}
          {head('Icon size')}
          {row('Small', view.size === 'sm', () => set(folder, { size: 'sm' }))}
          {row('Medium', view.size === 'md', () => set(folder, { size: 'md' }))}
          {row('Large', view.size === 'lg', () => set(folder, { size: 'lg' }))}
          {head('List')}
          {row('Descriptions', view.desc, () => set(folder, { desc: !view.desc }), view.mode !== 'list')}
          <div className="my-1 border-t border-[var(--border-color,#333)]" />
          {row('Reset to default', false, () => { reset(folder); setOpen(false); })}
        </div>,
        document.body,
      )}
    </>
  );
}

export function FolderContents({ category, windowId }: FolderContentsProps) {
  const { windows, openWindow } = useWindowStore();
  const { retroIcons } = useSettingsStore();
  const isAdmin = useIsAdmin();
  const sudobud = useIsSudobud();
  const { playOpen } = useSound();
  const mobile = useIsMobile();
  const view = useFolderView(category);
  const slot = useTitleBarSlot(windowId);

  const apps = APP_REGISTRY
    .filter(app => app.category === category && adminAppVisible(app, isAdmin, sudobud))
    .sort((a, b) => (view.betaLast ? Number(!!a.beta) - Number(!!b.beta) : 0) || (view.sort === 'za' ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title)));

  const handleOpenApp = (app: AppConfig) => {
    playOpen();

    // Block Ticker is a floating strip, not a window - just show it
    if (app.type === 'block-ticker') {
      useTickerStore.getState().show();
      return;
    }

    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    const position = calculateWindowPosition(
      windows,
      app.defaultSize,
      screenWidth,
      screenHeight
    );

    openWindow({
      id: app.id,
      type: app.type,
      title: app.title,
      position,
      size: app.defaultSize,
      minSize: app.minSize,
    });
  };

  const menu = <ViewMenu folder={category} view={view} />;
  const px = ICON_PX[view.size];

  return (
    <div className="h-full overflow-auto p-3 bg-[var(--bg-window)]">
      {slot ? createPortal(menu, slot) : <div className="flex justify-end mb-1">{menu}</div>}
      {view.mode === 'icons' ? (
        <div className={`grid ${COLS[view.size]} gap-2`}>
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => { if (mobile) handleOpenApp(app); }}
              onDoubleClick={() => handleOpenApp(app)}
              title={app.blurb}
              className="
                flex flex-col items-center justify-center
                p-3
                hover:bg-[var(--accent-gold)]/20
                active:bg-[var(--accent-gold)]/40
                rounded
                transition-colors
                cursor-pointer
              "
            >
              <div className="mb-2 flex items-center justify-center" style={{ width: px + 4, height: px + 4 }}>
                {/* An app with a mark shows it; everything else keeps its glyph.
                    Retro icons win either way - that setting is a deliberate
                    choice about how the whole desktop looks. */}
                <AppGlyph id={app.id} glyph={app.icon} size={px} retro={retroIcons} title={app.title} />
              </div>
              <span
                className="text-[var(--text-primary)] text-center leading-tight"
                style={{ fontFamily: 'var(--font-primary)', fontSize: 'var(--font-size-icon)' }}
              >
                {app.title}
              </span>
              {app.beta && <span className="mt-1"><BetaTag /></span>}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col">
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => { if (mobile) handleOpenApp(app); }}
              onDoubleClick={() => handleOpenApp(app)}
              className="flex items-center gap-3 px-2 py-1.5 rounded text-left hover:bg-[var(--accent-gold)]/20 active:bg-[var(--accent-gold)]/40 transition-colors cursor-pointer"
            >
              <AppGlyph id={app.id} glyph={app.icon} size={Math.round(px * 0.6)} retro={retroIcons} title={app.title} />
              <span className="text-[var(--text-primary)] shrink-0" style={{ fontFamily: 'var(--font-primary)', fontSize: 'var(--font-size-icon)' }}>{app.title}</span>
              {app.beta && <BetaTag />}
              {view.desc && app.blurb && (
                <span className="text-[var(--text-muted)] truncate min-w-0" style={{ fontSize: 'calc(var(--font-size-icon) * 0.85)' }}>{app.blurb}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Individual folder components for the registry
export function StatsFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="stats" windowId={windowId} />;
}

export function ChartsFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="charts" windowId={windowId} />;
}

export function ToolsFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="tools" windowId={windowId} />;
}

export function GamesFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="games" windowId={windowId} />;
}

export function PrivacyFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="privacy" windowId={windowId} />;
}

/** The collectibles: Pools, the Marketplace, and whatever collections follow. */
export function RingsFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="rings" windowId={windowId} />;
}

export function EducationFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="education" windowId={windowId} />;
}

export function MediaFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="media" windowId={windowId} />;
}

export function WidgetsFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="widgets" windowId={windowId} />;
}

/** ZEC-OS's own pieces: settings, themes, the account and the like. */
export function SystemFolderContents({ windowId }: { windowId?: string }) {
  return <FolderContents category="system" windowId={windowId} />;
}

export default FolderContents;
