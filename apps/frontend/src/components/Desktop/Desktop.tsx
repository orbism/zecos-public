'use client';

import { AppGlyph } from '@/components/ui/ZecIcon';
import { useState, useMemo, useEffect } from 'react';
import { useWindowStore } from '@/store/windowStore';
import { useSettingsStore, getIcon } from '@/store/settingsStore';
import { useCanViewAdmin } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { Window } from '@/components/Window/Window';
import { WindowErrorBoundary } from '@/components/Window/WindowErrorBoundary';
import { DesktopIcon, GRID_SIZE } from './DesktopIcon';
import { DesktopFolder } from './DesktopFolder';
import { useSound } from '@/hooks/useSound';

// App registry + AppConfig now live in @/config/appRegistry so standalone
// /<app> routes can read them without importing the desktop chrome.
// Re-exported here for existing consumers (Taskbar, FolderContents, ...).
export { APP_REGISTRY } from '@/config/appRegistry';
export type { AppConfig } from '@/config/appRegistry';
import { APP_REGISTRY, type AppConfig } from '@/config/appRegistry';
import { GuestPrompt } from '@/components/GuestPrompt/GuestPrompt';
import { SystemDialog } from '@/components/SystemDialog/SystemDialog';
import { useWatchlistSync } from '@/hooks/useWatchlistSync';
import { useSettingsSync } from '@/hooks/useSettingsSync';
import { useOsStateSync } from '@/hooks/useOsStateSync';


import { useTickerStore } from '@/store/tickerStore';
import { useGenerative } from '@/lib/generative/useGenerative';
import { GlyphWallpaper } from '@/lib/generative/GlyphWallpaper';
// Folder definitions
interface FolderDef {
  id: string;
  label: string;
  icon: string;
  category: AppConfig['category'];
}

const FOLDERS: FolderDef[] = [
  { id: 'stats-folder', label: 'Stats', icon: '📊', category: 'stats' },
  { id: 'charts-folder', label: 'Charts', icon: '📈', category: 'charts' },
  { id: 'tools-folder', label: 'Tools', icon: '🔧', category: 'tools' },
  { id: 'games-folder', label: 'Games', icon: '🎮', category: 'games' },
  { id: 'privacy-folder', label: 'Privacy', icon: '🔒', category: 'privacy' },
  { id: 'rings-folder', label: 'Rings', icon: '◎', category: 'rings' },
  { id: 'education-folder', label: 'Education', icon: '📖', category: 'education' },
  { id: 'media-folder', label: 'Media', icon: '🎵', category: 'media' },
  { id: 'system-folder', label: 'System', icon: '💾', category: 'system' },
  { id: 'widgets-folder', label: 'Widgets', icon: '🧩', category: 'widgets' },
];

export function Desktop() {
  const { windows, openWindow } = useWindowStore();
  const iconsHidden = useWindowStore((s) => s.iconsHidden);
  const desktopShown = useWindowStore((s) => s.desktopShown);
  const restoreDesktop = useWindowStore((s) => s.restoreDesktop);
  const { retroIcons } = useSettingsStore();
  const isAdmin = useCanViewAdmin();
  const { playOpen } = useSound();

  // Keep windows inside the viewport when it shrinks/rotates (debounced).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(t); t = setTimeout(() => useWindowStore.getState().fitToViewport(), 150); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); };
  }, []);

  useWatchlistSync();
  useSettingsSync();
  useOsStateSync(APP_REGISTRY);

  // Theme-aware values
  const getTheme = useThemeStore((state) => state.getTheme);
  const theme = getTheme();
  const backgroundType = useThemeStore((state) => state.backgroundType);
  const backgroundColor = useThemeStore((state) => state.backgroundColor);
  const backgroundBuiltin = useThemeStore((state) => state.backgroundBuiltin);
  const backgroundCustom = useThemeStore((state) => state.backgroundCustom);
  const backgroundUrl = useThemeStore((state) => state.backgroundUrl);

  const taskbarHeight = theme?.taskbar?.height || 54;
  const taskbarPosition = theme?.taskbar?.position || 'top';

  // Calculate initial positions for folders
  const initialFolderPositions = useMemo(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    const padding = 20;

    FOLDERS.forEach((folder, index) => {
      positions[folder.id] = {
        x: padding,
        y: padding + index * GRID_SIZE,
      };
    });

    // README and the manual sit a row below the folders, apart from them.
    positions['readme'] = {
      x: padding,
      y: padding + (FOLDERS.length + 1) * GRID_SIZE,
    };
    positions['darkforest-manual'] = {
      x: padding,
      y: padding + (FOLDERS.length + 2) * GRID_SIZE,
    };
    /*
     * Pools sits on the desktop as well as in its folder: it is the
     * collection, not a utility, and it should be reachable without opening
     * anything first. It gets the TOP OF ITS OWN third column - under the
     * folders in column one it was the last thing anyone saw.
     */
    positions['pools-shortcut'] = {
      x: padding + 2 * GRID_SIZE,
      y: padding,
    };
    positions['tutorial-shortcut'] = { x: padding + 2 * GRID_SIZE, y: padding + GRID_SIZE };

    // Second column: Terminal, Dark Forest, Explorer - to the right of the first column
    const col2x = padding + GRID_SIZE;
    positions['terminal-shortcut'] = { x: col2x, y: padding };
    positions['bbs-rpg-shortcut2'] = { x: col2x, y: padding + GRID_SIZE };
    positions['explorer-shortcut']  = { x: col2x, y: padding + 2 * GRID_SIZE };
    positions['registry-shortcut'] = { x: col2x, y: padding + 3 * GRID_SIZE };
    positions['hindsight-shortcut'] = { x: col2x, y: padding + 4 * GRID_SIZE };
    positions['tournament-admin-shortcut'] = { x: col2x, y: padding + 5 * GRID_SIZE };

    return positions;
  }, []);

  const [folderPositions, setFolderPositions] = useState<Record<string, { x: number; y: number }>>(initialFolderPositions);

  const handleFolderPositionChange = (folderId: string, newPos: { x: number; y: number }) => {
    setFolderPositions(prev => ({
      ...prev,
      [folderId]: newPos,
    }));
  };

  const handleOpenApp = (app: AppConfig) => {
    playOpen();
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

  // Open a folder window
  const handleOpenFolder = (folder: FolderDef) => {
    const folderConfig = APP_REGISTRY.find(app => app.id === folder.id);
    if (!folderConfig) return;

    playOpen();
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    const position = calculateWindowPosition(windows, folderConfig.defaultSize, screenWidth, screenHeight);

    openWindow({
      id: folderConfig.id,
      type: folderConfig.type,
      title: folderConfig.title,
      position,
      size: folderConfig.defaultSize,
      minSize: folderConfig.minSize,
    });
  };

  // Handle README open
  const handleOpenReadme = () => {
    playOpen();
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const defaultSize = { width: 780, height: 780 };

    const position = calculateWindowPosition(windows, defaultSize, screenWidth, screenHeight);

    openWindow({
      id: 'readme',
      type: 'readme',
      title: 'README.txt',
      position,
      size: defaultSize,
      minSize: { width: 480, height: 420 },
    });
  };

  const generative = useGenerative();

  /**
   * The wallpaper's image URL, or null when the background is a flat colour.
   *
   * Glyph mode redraws it as braille rather than tinting it, so it needs the
   * source rather than the CSS. A colour background has no picture to sample
   * and simply gets flat ground with the cursor still disturbing it.
   */
  const backgroundSrc = ((): string | null => {
    switch (backgroundType) {
      case 'builtin': return `/backgrounds/${backgroundBuiltin}.jpg`;
      case 'custom':  return backgroundCustom || null;
      case 'url':     return backgroundUrl || null;
      default:        return null;
    }
  })();

  // Calculate background style based on settings
  const getBackgroundStyle = (): React.CSSProperties => {
    /*
     * In glyph mode the picture is drawn by the canvas below, not by CSS.
     * Leaving the CSS image in place would show the real photograph through
     * every gap between dots, which is precisely the thing being replaced.
     */
    if (generative) return { backgroundColor: 'var(--bg-desktop)' };
    switch (backgroundType) {
      case 'color':
        return { backgroundColor: backgroundColor || 'var(--bg-desktop)' };
      case 'builtin':
        return {
          backgroundImage: `url(/backgrounds/${backgroundBuiltin}.jpg)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        };
      case 'custom':
        if (backgroundCustom) {
          return {
            backgroundImage: `url(${backgroundCustom})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          };
        }
        return { backgroundColor: 'var(--bg-desktop)' };
      case 'url':
        if (backgroundUrl) {
          return {
            backgroundImage: `url(${backgroundUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          };
        }
        return { backgroundColor: 'var(--bg-desktop)' };
      default:
        return { backgroundColor: 'var(--bg-desktop)' };
    }
  };

  /*
   * Usable desktop = viewport minus the taskbar AND minus the block ticker.
   *
   * The ticker itself is rendered OUTSIDE this container (in page.tsx), fixed to
   * the viewport above the taskbar. It used to live in here, which meant this
   * container's bottom had already subtracted the strip's height before the
   * strip positioned itself against it - so the strip sat a full height too
   * high, with dead space beneath and the usable desktop covered above.
   *
   * Reserving the measured height here and drawing the strip in that reserved
   * band is what makes a maximised window end exactly where the strip begins.
   * Closing the ticker gives the space back. And because this container clips
   * its children, no window can fall behind the strip.
   */
  const tickerVisible = useTickerStore((s) => s.visible);
  const tickerHeight = useTickerStore((s) => s.height);
  const reserved = tickerVisible ? tickerHeight : 0;
  const positionStyle: React.CSSProperties = taskbarPosition === 'bottom'
    ? { top: 0, bottom: `${taskbarHeight + reserved}px` }
    : { top: `${taskbarHeight}px`, bottom: `${reserved}px` };

  return (
    <div
      className="absolute left-0 right-0 overflow-hidden"
      style={{
        ...positionStyle,
        ...getBackgroundStyle(),
      }}
      onClick={() => restoreDesktop()}
    >
      {/* Under everything: z-0, and never interactive. */}
      {generative && (
        <div className="absolute inset-0 z-0" style={{ pointerEvents: 'none' }}>
          <GlyphWallpaper src={backgroundSrc} />
        </div>
      )}
      {/* Desktop Folders Container - z-index 1 (hidden via Hide Icons; never the coffee cup) */}
      {!iconsHidden && (
      <div className="desktop-icons absolute inset-0 z-[1]">
        {FOLDERS.map((folder) => (
          <DesktopFolder
            key={folder.id}
            tour={`folder-${folder.category}`}
            label={folder.label}
            icon={<AppGlyph id={folder.id} glyph={folder.icon} size={46} retro={retroIcons} folder />}
            onOpen={() => handleOpenFolder(folder)}
            position={folderPositions[folder.id] || initialFolderPositions[folder.id]}
            onPositionChange={(pos) => handleFolderPositionChange(folder.id, pos)}
          />
        ))}
        {/* README Icon */}
        <DesktopIcon
          label="README"
          icon={<AppGlyph id="readme" size={44} retro={retroIcons} />}
          onOpen={handleOpenReadme}
          position={folderPositions['readme'] || initialFolderPositions['readme']}
          onPositionChange={(pos) => handleFolderPositionChange('readme', pos)}
        />
        <DesktopIcon
          label="System Tutorial"
          icon={<AppGlyph id="system-tutorial" size={44} retro={retroIcons} />}
          onOpen={() => handleOpenApp(APP_REGISTRY.find(a => a.id === 'system-tutorial')!)}
          position={folderPositions['tutorial-shortcut'] || initialFolderPositions['tutorial-shortcut']}
          onPositionChange={(pos) => handleFolderPositionChange('tutorial-shortcut', pos)}
        />
        {/* Second column shortcuts */}
        <DesktopIcon
          label="Terminal"
          icon={<AppGlyph id="terminal" size={44} retro={retroIcons} />}
          onOpen={() => handleOpenApp(APP_REGISTRY.find(a => a.id === 'terminal')!)}
          position={folderPositions['terminal-shortcut'] || initialFolderPositions['terminal-shortcut']}
          onPositionChange={(pos) => handleFolderPositionChange('terminal-shortcut', pos)}
        />
        <DesktopIcon
          tour="icon-explorer"
          label="Explorer"
          icon={<AppGlyph id="explorer" size={44} retro={retroIcons} />}
          onOpen={() => handleOpenApp(APP_REGISTRY.find(a => a.id === 'explorer')!)}
          position={folderPositions['explorer-shortcut'] || initialFolderPositions['explorer-shortcut']}
          onPositionChange={(pos) => handleFolderPositionChange('explorer-shortcut', pos)}
        />
        <DesktopIcon
          label="Hindsight"
          icon={<AppGlyph id="hindsight" size={44} retro={retroIcons} />}
          onOpen={() => handleOpenApp(APP_REGISTRY.find(a => a.id === 'hindsight')!)}
          position={folderPositions['hindsight-shortcut'] || initialFolderPositions['hindsight-shortcut']}
          onPositionChange={(pos) => handleFolderPositionChange('hindsight-shortcut', pos)}
        />
        {/* Sysop-only shortcut - configure & fire tournaments */}
      </div>
      )}

      {/* Windows Layer - flies out of sight for "Show Desktop", back in on any
          window coming forward or a tap on the desktop. pointer-events:none so
          empty areas pass clicks through to the icons; each Window re-enables. */}
      <div
        className="absolute inset-0"
        style={{
          zIndex: 10, // above the desktop-icons layer (z-1); windows stack within
          pointerEvents: 'none',
          transform: desktopShown ? 'translateY(115vh)' : 'translateY(0)',
          transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
          willChange: 'transform',
        }}
      >
        {windows.map((win) => {
          const appConfig = APP_REGISTRY.find(a => a.type === win.type);
          if (!appConfig || !appConfig.component) return null;

          const AppComponent = appConfig.component as React.ComponentType<{ windowId?: string }>;

          return (
            <Window key={win.id} id={win.id}>
              <WindowErrorBoundary title={appConfig.title}>
                <AppComponent windowId={win.id} />
              </WindowErrorBoundary>
            </Window>
          );
        })}
      </div>

      {/* Guest sign-in prompt - shown when guest tries a persistent feature */}
      <GuestPrompt />
      <SystemDialog />
      {/* Mounted by the desktop, not by the Screensavers app - closing that
          window must not switch the feature off. */}
    </div>
  );
}
