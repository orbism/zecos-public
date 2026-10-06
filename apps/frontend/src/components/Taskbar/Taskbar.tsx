'use client';

import { UPGRADES } from '@/data/upgrades';
import { useStatusTab } from '@/components/apps/tools/ZcashStatus';
import { openApp } from '@/lib/openApp';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWindowStore } from '@/store/windowStore';
import { useSettingsStore, formatDate, formatTime, getIcon } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore, useIsAdmin, useIsSudobud, useCanViewAdmin } from '@/store/authStore';
import { FeedbackBell } from '@/components/Feedback/FeedbackBell';
import { ZimTray } from '@/components/apps/zim/ZimTray';
import { APP_REGISTRY, type AppConfig } from '@/components/Desktop/Desktop';
import { useSound, masterGain } from '@/hooks/useSound';
import { useApiHealth, useChainData, useCurrentPrice, useNodeStatus } from '@/hooks/useZecData';
import { useHealth, CHAIN_WORDS, chainsUnderMaintenance } from '@/hooks/useHealth';
import { sumShielded } from '@/config/pools';
import { adminAppVisible } from '@/config/appMeta';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { useIsMobile } from '@/hooks/useIsMobile';
import { CoffeeCup } from '@/components/CoffeeCup/CoffeeCup';
import { FeedbackButton } from '@/components/Feedback/FeedbackButton';
import { openZecamp, useZecamp, ZECAMP_APP } from '@/lib/zecamp/engine';
import { AppGlyph } from '@/components/ui/ZecIcon';

// App definitions for menu
interface MenuItem {
  id: string;
  type: string;
  title: string;
  icon: string;
  defaultSize: { width: number; height: number };
  minSize?: { width: number; height: number };
  disabled?: boolean;
}

// Menu items come from the single source of truth - APP_REGISTRY - so any app
// added there appears in BOTH its folder and this dropdown automatically, with
// admin-only apps gated to the sysop. (Folders already derive from the registry;
// this keeps the menu in lockstep instead of duplicating a hand-maintained list.)
function toMenuItem(a: AppConfig): MenuItem {
  return { id: a.id, type: a.type, title: a.title, icon: a.icon, defaultSize: a.defaultSize, minSize: a.minSize };
}

const ABOUT_ITEM: MenuItem = {
  id: 'about', type: 'about', title: 'About ZEC-OS', icon: 'ℹ️', defaultSize: { width: 660, height: 680 }, minSize: { width: 440, height: 460 }
};

// Legacy export for compatibility - actual height comes from theme
export const TASKBAR_HEIGHT = 54;

/**
 * The status flyout, and the icon that opens it.
 *
 * A flyout rather than a box that appears: it unrolls downward from the bar,
 * and its rows arrive behind it a beat apart. Status panels get opened when
 * something is wrong, and a panel that slides out of the thing you clicked is
 * easier to trust than one that is suddenly just there.
 *
 * The icon breathes orange while either chain is under maintenance. Slow and
 * shallow - 1.6s, never fully off - because this is a notice, not an alarm: it
 * has to be noticeable from across a desk without being the thing you look at.
 */
const FLYOUT_CSS = `
.tb-tray { display:flex; align-items:center; gap:2px; padding:1px 3px; border:1px solid var(--border-window); border-radius:3px; background:rgba(255,255,255,.04); }
.tb-ico { background:transparent; border:1px solid transparent; border-radius:3px; cursor:pointer; }
.tb-ico:hover { background:rgba(255,255,255,.08); }
.tb-tray > .relative > button.btn-window, .tb-tray-panel > .relative > button.btn-window { background:transparent; border-color:transparent; box-shadow:none; }
.tb-tray > .relative > button.btn-window:hover, .tb-tray-panel > .relative > button.btn-window:hover { background:rgba(255,255,255,.08); }
.tb-arrow { align-self:stretch; padding:0 6px; font-size:15px; line-height:1; color:var(--accent-gold); border-right:1px solid var(--border-window) !important; border-radius:0 !important; }
.tb-tray-panel { position:absolute; z-index:10000; display:flex; align-items:center; gap:2px; padding:3px 5px;
  background:var(--bg-titlebar); border:1px solid var(--border-window); box-shadow:0 6px 16px rgba(0,0,0,.45); }
.tb-playing img { animation:tb-zglow 2.4s ease-in-out infinite; }
@keyframes tb-zglow {
  0%, 100% { filter:drop-shadow(0 0 1px rgba(244,183,40,.5)); }
  50%      { filter:drop-shadow(0 0 5px rgba(244,183,40,.95)); }
}
@media (prefers-reduced-motion: reduce) { .tb-playing img { animation:none; filter:drop-shadow(0 0 3px rgba(244,183,40,.8)); } }
@keyframes tb-unroll {
  from { opacity:0; transform:translateY(-8px) scaleY(.82); }
  to   { opacity:1; transform:translateY(0)    scaleY(1); }
}
@keyframes tb-rowin {
  from { opacity:0; transform:translateY(-5px); }
  to   { opacity:1; transform:none; }
}
@keyframes tb-breathe {
  0%, 100% { opacity:1; }
  50%      { opacity:.35; }
}
.tb-flyout { transform-origin:top right; animation:tb-unroll .18s cubic-bezier(.2,.9,.3,1) both; }
.tb-flyout > * { animation:tb-rowin .22s ease-out both; }
.tb-flyout > *:nth-child(1) { animation-delay:.04s; }
.tb-flyout > *:nth-child(2) { animation-delay:.08s; }
.tb-flyout > *:nth-child(3) { animation-delay:.12s; }
.tb-flyout > *:nth-child(4) { animation-delay:.16s; }
.tb-breathe { animation:tb-breathe 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .tb-flyout, .tb-flyout > *, .tb-breathe { animation:none; opacity:1; transform:none; }
}
`;

/** Chain rows, in the order anybody cares about them. */
const CHAIN_ROWS: { key: 'mainnet' | 'testnet'; label: string }[] = [
  { key: 'mainnet', label: 'Mainnet' },
  { key: 'testnet', label: 'Testnet' },
];

export function Taskbar() {
  const { windows, focusWindow, openWindow, cascadeWindows, closeAll, toggleIcons, iconsHidden, showDesktop } = useWindowStore();
  const { dateFormat, timeFormat, soundEnabled, setSoundEnabled, retroIcons, setRetroIcons, volume, setVolume, generative, setGenerative } = useSettingsStore();
  const volPct = Math.round(volume * 100); // store volume is 0-1; UI shows 0-100

  // Category menus, derived from APP_REGISTRY (admin-only apps gated to the sysop),
  // sorted by title like the folders. Recomputes when admin status changes so the
  // sysop's extra tools appear/disappear correctly.
  const isAdmin = useIsAdmin();
  const sudobud = useIsSudobud();
  const canView = useCanViewAdmin();
  const menus = useMemo(() => {
    const build = (cat: AppConfig['category']) => APP_REGISTRY
      .filter(a => a.category === cat && adminAppVisible(a, isAdmin, sudobud))
      .map(toMenuItem)
      .sort((a, b) => a.title.localeCompare(b.title));
    return {
      stats: build('stats'), charts: build('charts'), tools: build('tools'),
      games: build('games'), privacy: build('privacy'), widgets: build('widgets'),
      rings: build('rings'), education: build('education'), media: build('media'),
      system: build('system'),
    };
  }, [isAdmin, sudobud]);

  // Live audio preview: a continuous tone while the volume slider is held, so you
  // hear the level change in realtime (instead of a beep on release).
  const previewRef = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null>(null);
  const previewLevel = () => Math.min(1.2, 0.16 * masterGain());
  const startPreview = () => {
    if (!soundEnabled || previewRef.current) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 523.25;
      const gain = ctx.createGain(); gain.gain.value = previewLevel();
      osc.connect(gain); gain.connect(ctx.destination); osc.start();
      previewRef.current = { ctx, osc, gain };
    } catch { /* audio unavailable */ }
  };
  const updatePreview = () => {
    const p = previewRef.current;
    if (p) { try { p.gain.gain.setTargetAtTime(previewLevel(), p.ctx.currentTime, 0.02); } catch { /* noop */ } }
  };
  const stopPreview = () => {
    const p = previewRef.current;
    if (!p) return;
    previewRef.current = null;
    try {
      p.gain.gain.setTargetAtTime(0.0001, p.ctx.currentTime, 0.03);
      p.osc.stop(p.ctx.currentTime + 0.12);
      setTimeout(() => { try { p.ctx.close(); } catch { /* noop */ } }, 250);
    } catch { /* noop */ }
  };
  const getTheme = useThemeStore((state) => state.getTheme);
  const theme = getTheme();
  const { playClick, playOpen } = useSound();
  const { displayName, walletAddress, isGuest, isAuthenticated, sessionToken, isVerified } = useAuthStore();
  const { healthy, lastUpdate, latency, blockHeight: apiBlockHeight, priceUsd, shieldedPercent: apiShieldedPercent, totalShielded } = useApiHealth();
  const { data: chainData } = useChainData();
  const { price: currentPrice } = useCurrentPrice();
  // Admin-only: which node architecture is currently active (Zebra vs Zakura).
  const { node: activeNode, subversion: nodeSubversion } = useNodeStatus();

  // Calculate stats for taskbar
  const blockHeight = chainData?.height ?? 0;
  const pools = chainData?.pools;
  const totalSupply = 21_000_000; // ZEC max supply
  const shieldedTotal = sumShielded(pools); // incl. ironwood, excl. lockbox
  const shieldedPercent = totalSupply > 0 ? ((shieldedTotal / totalSupply) * 100).toFixed(1) : '-';

  // Theme-aware values
  const taskbarHeight = theme?.taskbar?.height || 54;
  const taskbarPosition = theme?.taskbar?.position || 'top';
  const logoType = theme?.taskbar?.logoType || 'text';
  const logoText = theme?.taskbar?.logoText || 'ZEC-OS';
  const logoImage = theme?.taskbar?.logoImage || '/zec-logo.svg';

  const [time, setTime] = useState<Date>(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [appsSubmenuOpen, setAppsSubmenuOpen] = useState(false);
  const [statsSubmenuOpen, setStatsSubmenuOpen] = useState(false);
  const [chartsSubmenuOpen, setChartsSubmenuOpen] = useState(false);
  const [gamesSubmenuOpen, setGamesSubmenuOpen] = useState(false);
  const [widgetsSubmenuOpen, setWidgetsSubmenuOpen] = useState(false);
  const [toolsSubmenuOpen, setToolsSubmenuOpen] = useState(false);
  const [systemSubmenuOpen, setSystemSubmenuOpen] = useState(false);
  const [privacySubmenuOpen, setPrivacySubmenuOpen] = useState(false);
  const [ringsSubmenuOpen, setRingsSubmenuOpen] = useState(false);
  const [educationSubmenuOpen, setEducationSubmenuOpen] = useState(false);
  const [mediaSubmenuOpen, setMediaSubmenuOpen] = useState(false);
  const [wirelessPopupOpen, setWirelessPopupOpen] = useState(false);
  /* Both chains, on the shared slow poll - see useHealth. */
  const health = useHealth();
  const maintenance = chainsUnderMaintenance(health);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const mobile = useIsMobile();
  /*
   * Below this the tray does not fit: coffee, suggestions, volume and network
   * status were pushed off the right edge where nobody could reach them. So
   * the tray tucks behind ☰, keeping only the bell and ZIM (their counts must
   * stay visible) out in the open.
   */
  const compact = useIsMobile(1023);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  // The icon tray: minimised or not (remembered), and the hover panel it opens when minimised.
  const [trayMin, setTrayMin] = useState(false);
  useEffect(() => { try { setTrayMin(localStorage.getItem('zec-tray-min') === '1'); } catch { /* private mode */ } }, []);
  const toggleTray = () => setTrayMin((v) => {
    try { localStorage.setItem('zec-tray-min', v ? '0' : '1'); } catch { /* private mode */ }
    return !v;
  });
  const [trayHover, setTrayHover] = useState(false);
  const [trayPos, setTrayPos] = useState({ right: 0, bridge: 0 });
  const trayRef = useRef<HTMLDivElement>(null);
  const trayT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trayEnter = () => {
    if (trayT.current) clearTimeout(trayT.current);
    const t = trayRef.current, bar = t?.offsetParent as HTMLElement | null;
    if (t && bar) {
      const tr = t.getBoundingClientRect(), br = bar.getBoundingClientRect();
      setTrayPos({ right: br.right - tr.right, bridge: taskbarPosition === 'bottom' ? tr.top - br.top : br.bottom - tr.bottom });
    }
    setTrayHover(true);
  };
  const trayLeave = () => { trayT.current = setTimeout(() => setTrayHover(false), 250); };
  const zecPlaying = useZecamp((s) => s.playing);
  // Stop any preview tone when the volume dropdown closes.
  useEffect(() => { if (!volumeOpen) stopPreview(); }, [volumeOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const menuRef    = useRef<HTMLDivElement>(null);
  const wirelessRef = useRef<HTMLDivElement>(null);
  const volumeRef  = useRef<HTMLDivElement>(null);
  const statsRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setAppsSubmenuOpen(false);
        setStatsSubmenuOpen(false);
        setChartsSubmenuOpen(false);
        setGamesSubmenuOpen(false);
        setWidgetsSubmenuOpen(false);
        setToolsSubmenuOpen(false);
        setSystemSubmenuOpen(false);
        setPrivacySubmenuOpen(false);
        setRingsSubmenuOpen(false);
        setEducationSubmenuOpen(false);
        setMediaSubmenuOpen(false);
      }
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
      if (wirelessRef.current && !wirelessRef.current.contains(e.target as Node)) {
        setWirelessPopupOpen(false);
      }
      if (volumeRef.current && !volumeRef.current.contains(e.target as Node)) {
        setVolumeOpen(false);
      }
      if (statsRef.current && !statsRef.current.contains(e.target as Node)) {
        setStatsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const closeAllMenus = () => {
    setMenuOpen(false);
    setAppsSubmenuOpen(false);
    setStatsSubmenuOpen(false);
    setChartsSubmenuOpen(false);
    setGamesSubmenuOpen(false);
    setWidgetsSubmenuOpen(false);
    setToolsSubmenuOpen(false);
    setSystemSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
  };

  const handleOpenApp = (item: MenuItem) => {
    if (item.disabled) {
      playClick();
      return;
    }
    playOpen();
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    const position = calculateWindowPosition(windows, item.defaultSize, screenWidth, screenHeight);

    openWindow({
      id: item.id,
      type: item.type,
      title: item.title,
      position,
      size: item.defaultSize,
      minSize: item.minSize,
    });
    closeAllMenus();
  };

  const openAccountApp = () => {
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const size = { width: 620, height: 640 };
    const existing = windows.find(w => w.type === 'account');
    if (existing) { focusWindow(existing.id); return; }
    openWindow({
      id: 'account',
      type: 'account',
      title: 'Account',
      position: calculateWindowPosition(windows, size, screenWidth, screenHeight),
      size,
      minSize: { width: 460, height: 480 },
    });
  };

  const handleMenuToggle = () => {
    playClick();
    if (menuOpen) {
      closeAllMenus();
    } else {
      setMenuOpen(true);
    }
  };

  const handleAppsHover = () => {
    setAppsSubmenuOpen(true);
    setGamesSubmenuOpen(false);
    setWidgetsSubmenuOpen(false);
    setToolsSubmenuOpen(false);
    setSystemSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
  };

  const handleGamesHover = () => {
    setGamesSubmenuOpen(true);
    setWidgetsSubmenuOpen(false);
    setAppsSubmenuOpen(false);
    setToolsSubmenuOpen(false);
    setSystemSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
  };

  const handleWidgetsHover = () => {
    setWidgetsSubmenuOpen(true);
    setGamesSubmenuOpen(false);
    setAppsSubmenuOpen(false);
    setToolsSubmenuOpen(false);
    setSystemSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
  };

  const handleToolsHover = () => {
    setToolsSubmenuOpen(true);
    setSystemSubmenuOpen(false);
    setAppsSubmenuOpen(false);
    setGamesSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
  };

  const handleSystemHover = () => {
    setSystemSubmenuOpen(true);
    setToolsSubmenuOpen(false);
    setAppsSubmenuOpen(false);
    setGamesSubmenuOpen(false);
    setWidgetsSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
  };

  const handleStatsHover = () => {
    setStatsSubmenuOpen(true);
    setChartsSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
  };

  const handleChartsHover = () => {
    setChartsSubmenuOpen(true);
    setStatsSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
  };

  const handlePrivacyInAppsHover = () => {
    setPrivacySubmenuOpen(true);
    setRingsSubmenuOpen(false);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
    setStatsSubmenuOpen(false);
    setChartsSubmenuOpen(false);
  };

  const handleRingsInAppsHover = () => {
    setRingsSubmenuOpen(true);
    setEducationSubmenuOpen(false);
    setMediaSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setStatsSubmenuOpen(false);
    setChartsSubmenuOpen(false);
  };

  const handleEducationInAppsHover = () => {
    setEducationSubmenuOpen(true);
    setMediaSubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setStatsSubmenuOpen(false);
    setChartsSubmenuOpen(false);
  };

  const handleMediaInAppsHover = () => {
    setMediaSubmenuOpen(true);
    setEducationSubmenuOpen(false);
    setRingsSubmenuOpen(false);
    setPrivacySubmenuOpen(false);
    setStatsSubmenuOpen(false);
    setChartsSubmenuOpen(false);
  };

  const handleSoundToggle = () => {
    if (soundEnabled) playClick();
    setSoundEnabled(!soundEnabled);
    if (!soundEnabled) setTimeout(() => playClick(), 50);
  };

  /*
   * Kept alive while its button is hidden from the tray.
   *
   * `void` rather than deleted: the moment the retro icon set is complete this
   * is the whole feature again, and the alternative is deleting a working
   * handler and its store wiring only to write both back.
   */
  const handleRetroToggle = () => {
    playClick();
    setRetroIcons(!retroIcons);
  };
  void handleRetroToggle;

  const handleGenerativeToggle = () => {
    playClick();
    setGenerative(!generative);
  };

  const healthColor = healthy === null ? 'var(--text-amber)' : healthy ? 'var(--accent-green)' : 'var(--accent-orange)';

  // menus at 26px; the tray, where each icon is the whole button, at 30
  const icon = (emoji: string, id?: string, size = 26) => <AppGlyph id={id} glyph={emoji} size={size} retro={retroIcons} />;

  // Position classes based on theme
  const positionClasses = taskbarPosition === 'bottom'
    ? 'fixed bottom-0 left-0 right-0 border-t-2'
    : 'fixed top-0 left-0 right-0 border-b-2';

  return (
    <div
      className={`
        ${positionClasses}
        bg-[var(--bg-titlebar)]
        border-[var(--border-dark)]
        flex items-center justify-between
        px-2
        z-[9999]
      `}
      style={{ height: `${taskbarHeight}px` }}
    >
      <style>{FLYOUT_CSS}</style>
      {/* Left: App Menu */}
      <div className="relative" ref={menuRef}>
        <button
          data-tour="zmenu-button"
          onClick={handleMenuToggle}
          className="
            btn-window px-3 py-2
            text-[var(--accent-gold)]
            flex items-center gap-2
          "
          style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-icon)' }}
        >
          {logoType === 'image' ? (
            <img src={logoImage} alt="ZEC-OS" className="h-6 w-6" style={{ imageRendering: 'pixelated' }} />
          ) : (
            <span className={retroIcons ? 'text-[var(--text-primary)] text-sm' : ''}>{logoText}</span>
          )}
          <span style={{ fontSize: '10px' }}>▼</span>
        </button>

        {/* Main Dropdown Menu */}
        {menuOpen && (
          <div
            data-tour="zmenu-dropdown"
            className="
              absolute top-full left-0 mt-1
              bg-[#1a1a2e]
              window-border
              min-w-52
              z-[9999]
            "
          >
            <div className="py-1">
              {/* About */}
              <button
                onClick={() => handleOpenApp(ABOUT_ITEM)}
                className="
                  w-full px-3 py-2 text-left
                  hover:bg-[var(--accent-gold)]/20
                  flex items-center gap-3
                  text-[var(--text-primary)]
                "
                style={{ fontSize: 'var(--font-size-menu)' }}
              >
                <span>{icon(ABOUT_ITEM.icon, ABOUT_ITEM.id)}</span>
                <span>{ABOUT_ITEM.title}</span>
              </button>

              {/* Desktop actions */}
              {[
                { key: 'showdesktop', id: 'show-desktop', icon: '⬇️', label: 'Show Desktop', run: () => showDesktop() },
                { key: 'stack', id: 'stack-windows', icon: '🗂️', label: 'Stack Em', run: () => cascadeWindows() },
                { key: 'closeall', id: 'close-all', icon: '✖️', label: 'Close All', run: () => closeAll() },
                { key: 'icons', id: 'toggle-icons', icon: '🖥️', label: iconsHidden ? 'Show Icons' : 'Hide Icons', run: () => toggleIcons() },
              ].map((a) => (
                <button
                  key={a.key}
                  data-tour={`zmenu-${a.key}`}
                  onClick={() => { a.run(); closeAllMenus(); }}
                  className="w-full px-3 py-2 text-left hover:bg-[var(--accent-gold)]/20 flex items-center gap-3 text-[var(--text-primary)]"
                  style={{ fontSize: 'var(--font-size-menu)' }}
                >
                  <span>{icon(a.icon, a.id)}</span>
                  <span>{a.label}</span>
                </button>
              ))}

              {/* Divider */}
              <div className="border-t border-[var(--border-window)] my-1" />

              {/* Apps Submenu */}
              <div
                className="relative"
                onMouseEnter={handleAppsHover}
              >
                <button
                  className="
                    w-full px-3 py-2 text-left
                    hover:bg-[var(--accent-gold)]/20
                    flex items-center justify-between
                    text-[var(--text-secondary)]
                  "
                  style={{ fontSize: 'var(--font-size-menu)' }}
                >
                  <span className="flex items-center gap-3">
                    <span>{icon('📊')}</span>
                    <span>Apps</span>
                  </span>
                  <span>▶</span>
                </button>

                {/* Apps Submenu Dropdown - contains Stats and Charts */}
                {appsSubmenuOpen && (
                  <div
                    className="
                      absolute left-full top-0
                      bg-[#1a1a2e]
                      window-border
                      min-w-40
                    "
                  >
                    {/* Stats Submenu */}
                    <div className="relative" onMouseEnter={handleStatsHover}>
                      <button
                        className="
                          w-full px-3 py-2 text-left
                          hover:bg-[var(--accent-gold)]/20
                          flex items-center justify-between
                          text-[var(--text-secondary)]
                        "
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span className="flex items-center gap-3">
                          <span>{icon('📊')}</span>
                          <span>Stats</span>
                        </span>
                        <span>▶</span>
                      </button>

                      {statsSubmenuOpen && (
                        <div
                          className="
                            absolute left-full top-0
                            bg-[#1a1a2e]
                            window-border
                            min-w-48
                          "
                        >
                          {menus.stats.map((app) => (
                            <button
                              key={app.id}
                              onClick={() => handleOpenApp(app)}
                              className="
                                w-full px-3 py-2 text-left
                                hover:bg-[var(--accent-gold)]/20
                                flex items-center gap-3
                                text-[var(--text-primary)]
                              "
                              style={{ fontSize: 'var(--font-size-menu)' }}
                            >
                              <span>{icon(app.icon, app.id)}</span>
                              <span>{app.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Charts Submenu */}
                    <div className="relative" onMouseEnter={handleChartsHover}>
                      <button
                        className="
                          w-full px-3 py-2 text-left
                          hover:bg-[var(--accent-gold)]/20
                          flex items-center justify-between
                          text-[var(--text-secondary)]
                        "
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span className="flex items-center gap-3">
                          <span>{icon('📈', 'charts-folder')}</span>
                          <span>Charts</span>
                        </span>
                        <span>▶</span>
                      </button>

                      {chartsSubmenuOpen && (
                        <div
                          className="
                            absolute left-full top-0
                            bg-[#1a1a2e]
                            window-border
                            min-w-48
                          "
                        >
                          {menus.charts.map((app) => (
                            <button
                              key={app.id}
                              onClick={() => handleOpenApp(app)}
                              className="
                                w-full px-3 py-2 text-left
                                hover:bg-[var(--accent-gold)]/20
                                flex items-center gap-3
                                text-[var(--text-primary)]
                              "
                              style={{ fontSize: 'var(--font-size-menu)' }}
                            >
                              <span>{icon(app.icon, app.id)}</span>
                              <span>{app.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Privacy Submenu (nested under Apps) */}
                    <div className="relative" onMouseEnter={handlePrivacyInAppsHover}>
                      <button
                        className="
                          w-full px-3 py-2 text-left
                          hover:bg-[var(--accent-gold)]/20
                          flex items-center justify-between
                          text-[var(--text-secondary)]
                        "
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span className="flex items-center gap-3">
                          <span>{icon('🔒')}</span>
                          <span>Privacy</span>
                        </span>
                        <span>▶</span>
                      </button>

                      {privacySubmenuOpen && (
                        <div
                          className="
                            absolute left-full top-0
                            bg-[#1a1a2e]
                            window-border
                            min-w-48
                          "
                        >
                          {menus.privacy.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => handleOpenApp(item)}
                              className="
                                w-full px-3 py-2 text-left
                                hover:bg-[var(--accent-gold)]/20
                                flex items-center gap-3
                                text-[var(--text-primary)]
                              "
                              style={{ fontSize: 'var(--font-size-menu)' }}
                            >
                              <span>{icon(item.icon, item.id)}</span>
                              <span>{item.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Rings Submenu - the collectibles, kept out of Privacy:
                        a collection is something you own, not a privacy tool. */}
                    <div className="relative" onMouseEnter={handleRingsInAppsHover}>
                      <button
                        className="
                          w-full px-3 py-2 text-left
                          hover:bg-[var(--accent-gold)]/20
                          flex items-center justify-between
                          text-[var(--text-secondary)]
                        "
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span className="flex items-center gap-3">
                          <span>{icon('\u25CE')}</span>
                          <span>Rings</span>
                        </span>
                        <span>▶</span>
                      </button>

                      {ringsSubmenuOpen && (
                        <div
                          className="
                            absolute left-full top-0
                            bg-[#1a1a2e]
                            window-border
                            min-w-48
                          "
                        >
                          {menus.rings.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => handleOpenApp(item)}
                              className="
                                w-full px-3 py-2 text-left
                                hover:bg-[var(--accent-gold)]/20
                                flex items-center gap-3
                                text-[var(--text-primary)]
                              "
                              style={{ fontSize: 'var(--font-size-menu)' }}
                            >
                              <span>{icon(item.icon, item.id)}</span>
                              <span>{item.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Education Submenu - the Zecronomicon and its sysop switches. */}
                    <div className="relative" onMouseEnter={handleEducationInAppsHover}>
                      <button
                        className="
                          w-full px-3 py-2 text-left
                          hover:bg-[var(--accent-gold)]/20
                          flex items-center justify-between
                          text-[var(--text-secondary)]
                        "
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span className="flex items-center gap-3">
                          <span>{icon('📖')}</span>
                          <span>Education</span>
                        </span>
                        <span>▶</span>
                      </button>

                      {educationSubmenuOpen && (
                        <div
                          className="
                            absolute left-full top-0
                            bg-[#1a1a2e]
                            window-border
                            min-w-48
                          "
                        >
                          {menus.education.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => handleOpenApp(item)}
                              className="
                                w-full px-3 py-2 text-left
                                hover:bg-[var(--accent-gold)]/20
                                flex items-center gap-3
                                text-[var(--text-primary)]
                              "
                              style={{ fontSize: 'var(--font-size-menu)' }}
                            >
                              <span>{icon(item.icon, item.id)}</span>
                              <span>{item.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Media Submenu - zecAmp, and the media apps to come. */}
                    <div className="relative" onMouseEnter={handleMediaInAppsHover}>
                      <button
                        className="
                          w-full px-3 py-2 text-left
                          hover:bg-[var(--accent-gold)]/20
                          flex items-center justify-between
                          text-[var(--text-secondary)]
                        "
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span className="flex items-center gap-3">
                          <span>{icon('🎵')}</span>
                          <span>Media</span>
                        </span>
                        <span>▶</span>
                      </button>

                      {mediaSubmenuOpen && (
                        <div
                          className="
                            absolute left-full top-0
                            bg-[#1a1a2e]
                            window-border
                            min-w-48
                          "
                        >
                          {menus.media.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => handleOpenApp(item)}
                              className="
                                w-full px-3 py-2 text-left
                                hover:bg-[var(--accent-gold)]/20
                                flex items-center gap-3
                                text-[var(--text-primary)]
                              "
                              style={{ fontSize: 'var(--font-size-menu)' }}
                            >
                              <span>{icon(item.icon, item.id)}</span>
                              <span>{item.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Widgets Submenu */}
              <div className="relative" onMouseEnter={handleWidgetsHover}>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[var(--accent-gold)]/20 flex items-center justify-between text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--font-size-menu)' }}
                >
                  <span className="flex items-center gap-3">
                    <span>{icon('🧩')}</span>
                    <span>Widgets</span>
                  </span>
                  <span>▶</span>
                </button>
                {widgetsSubmenuOpen && (
                  <div className="absolute left-full top-0 bg-[#1a1a2e] window-border min-w-48">
                    {menus.widgets.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => handleOpenApp(w)}
                        className="w-full px-3 py-2 text-left hover:bg-[var(--accent-gold)]/20 flex items-center gap-3 text-[var(--text-primary)]"
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span>{icon(w.icon, w.id)}</span>
                        <span>{w.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Games Submenu */}
              <div
                className="relative"
                onMouseEnter={handleGamesHover}
              >
                <button
                  className="
                    w-full px-3 py-2 text-left
                    hover:bg-[var(--accent-gold)]/20
                    flex items-center justify-between
                    text-[var(--text-secondary)]
                  "
                  style={{ fontSize: 'var(--font-size-menu)' }}
                >
                  <span className="flex items-center gap-3">
                    <span>{icon('🎮')}</span>
                    <span>Games</span>
                  </span>
                  <span>▶</span>
                </button>

                {gamesSubmenuOpen && (
                  <div
                    className="
                      absolute left-full top-0
                      bg-[#1a1a2e]
                      window-border
                      min-w-48
                    "
                  >
                    {menus.games.map((game) => (
                      <button
                        key={game.id}
                        onClick={() => handleOpenApp(game)}
                        className="
                          w-full px-3 py-2 text-left
                          hover:bg-[var(--accent-gold)]/20
                          flex items-center gap-3
                          text-[var(--text-primary)]
                        "
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span>{icon(game.icon, game.id)}</span>
                        <span>{game.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Tools Submenu */}
              <div
                className="relative"
                onMouseEnter={handleToolsHover}
              >
                <button
                  className="
                    w-full px-3 py-2 text-left
                    hover:bg-[var(--accent-gold)]/20
                    flex items-center justify-between
                    text-[var(--text-secondary)]
                  "
                  style={{ fontSize: 'var(--font-size-menu)' }}
                >
                  <span className="flex items-center gap-3">
                    <span>{icon('🔧')}</span>
                    <span>Tools</span>
                  </span>
                  <span>▶</span>
                </button>

                {/* Tools Submenu Dropdown */}
                {toolsSubmenuOpen && (
                  <div
                    className="
                      absolute left-full top-0
                      bg-[#1a1a2e]
                      window-border
                      min-w-48
                    "
                  >
                    {menus.tools.map((tool) => (
                      <button
                        key={tool.id}
                        onClick={() => handleOpenApp(tool)}
                        className="
                          w-full px-3 py-2 text-left
                          hover:bg-[var(--accent-gold)]/20
                          flex items-center gap-3
                          text-[var(--text-primary)]
                        "
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span>{icon(tool.icon, tool.id)}</span>
                        <span>{tool.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* System Submenu - ZEC-OS's own pieces: settings, themes, account and the like. */}
              <div className="relative" onMouseEnter={handleSystemHover}>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[var(--accent-gold)]/20 flex items-center justify-between text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--font-size-menu)' }}
                >
                  <span className="flex items-center gap-3">
                    <span>{icon('💾')}</span>
                    <span>System</span>
                  </span>
                  <span>▶</span>
                </button>
                {systemSubmenuOpen && (
                  <div className="absolute left-full top-0 bg-[#1a1a2e] window-border min-w-48">
                    {menus.system.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleOpenApp(item)}
                        className="w-full px-3 py-2 text-left hover:bg-[var(--accent-gold)]/20 flex items-center gap-3 text-[var(--text-primary)]"
                        style={{ fontSize: 'var(--font-size-menu)' }}
                      >
                        <span>{icon(item.icon, item.id)}</span>
                        <span>{item.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </div>

      {/* Center: Minimized Windows */}
      <div className="flex-1 flex items-center gap-1 mx-4 overflow-x-auto">
        {windows
          .filter(w => w.minimized && !w.parked && w.type !== ZECAMP_APP)
          .map((win) => (
            <button
              key={win.id}
              data-window-tab={win.id}
              onClick={() => {
                playClick();
                focusWindow(win.id);
              }}
              className="
                btn-window px-3 py-2
                text-[var(--text-primary)]
                flex items-center gap-1
                max-w-40 truncate
              "
              style={{ fontSize: 'var(--font-size-button)' }}
            >
              <span className="truncate">{win.title}</span>
            </button>
          ))}
      </div>

      {/* Stats Display - collapsed into a dropdown on mobile */}
      {mobile ? (
        <div className="relative" ref={statsRef}>
          <button
            onClick={() => setStatsOpen(o => !o)}
            className="btn-window flex items-center justify-center"
            title="Info & account"
            style={{ minWidth: 40, minHeight: 40, fontSize: 'var(--font-size-button)' }}
          >
            ℹ️
          </button>
          {statsOpen && (
            <div className="absolute right-0 top-full mt-1 bg-[#1a1a2e] window-border z-[9999] min-w-48 p-3 flex flex-col gap-2" style={{ fontSize: 'var(--font-size-menu)' }}>
              {currentPrice && <div className="text-[var(--accent-gold)]"><span className="text-[var(--accent-green)]">ZEC:</span> ${currentPrice.toFixed(2)}</div>}
              <div className="text-[var(--accent-green)]">Shielded: <span className="text-[var(--accent-gold)]">{shieldedPercent}%</span></div>
              {blockHeight > 0 && <div className="text-[var(--text-primary)]">Block: <span className="text-[var(--accent-gold)]">#{blockHeight.toLocaleString()}</span></div>}
              {isAuthenticated && (
                <div className="border-t border-[var(--border-window)] pt-2 flex items-center justify-between gap-2">
                  <button onClick={openAccountApp} className="text-[var(--accent-green)] truncate bg-transparent border-0 p-0 cursor-pointer">
                    {isGuest ? 'guest' : (displayName || (walletAddress ? `${walletAddress.slice(0, 6)}…` : 'anon'))}
                  </button>
                  <button onClick={() => { useAuthStore.getState().logout(); window.location.reload(); }} style={{ color: '#FF5555' }} title="Log out">Log out</button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
      <div className="flex items-center gap-5 px-4" style={{ fontSize: 'calc(var(--font-size-menu) * 0.78)' }}>
        {currentPrice && (
          <span className="text-[var(--accent-gold)]" title="ZEC/USD Price">
            <span className="text-[var(--accent-green)]">ZEC:</span> ${currentPrice.toFixed(2)}
          </span>
        )}
        <span className="text-[var(--accent-green)]" title="Shielded % of Total Supply">
          Shielded: <span className="text-[var(--accent-gold)]">{shieldedPercent}%</span>
        </span>
        {blockHeight > 0 && (
          <span className="text-[var(--text-primary)]" title="Current Block Height">
            Block Height: <span className="text-[var(--accent-gold)]">#{blockHeight.toLocaleString()}</span>
          </span>
        )}
        {isAuthenticated && (
          // "logged in as", name, synced and log out: one outlined object, a link as a whole.
          <span
            className="flex items-center gap-2 border border-[var(--accent-gold)] cursor-pointer"
            style={{ padding: '2px 4px 2px 10px', borderRadius: 3 }}
            title={walletAddress ?? 'Guest session'}
            onClick={isGuest ? undefined : openAccountApp}
          >
            <span className="text-[var(--text-muted)]">logged in as </span>
            {isGuest ? (
              <span className="text-[var(--text-muted)] opacity-60">guest</span>
            ) : (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); openAccountApp(); }}
                  title="Open Account"
                  className="text-[var(--accent-green)] font-mono hover:underline cursor-pointer bg-transparent border-0 p-0"
                >
                  {displayName
                    ? displayName
                    : walletAddress
                      ? `${walletAddress.slice(0, 8)}…${walletAddress.slice(-4)}`
                      : 'anon'}
                </button>
                <span
                  className="text-[var(--accent-gold)]"
                  style={{ fontSize: '10px' }}
                  title="Ownership verified - synced to server"
                >
                  · synced
                </span>
              </>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); useAuthStore.getState().logout(); window.location.reload(); }}
              className="logout-btn flex items-center border border-transparent hover:border-[var(--border-window)] transition-colors cursor-pointer"
              title="Log out"
              style={{ color: '#FF5555', padding: '1px 4px' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </span>
        )}
      </div>
      )}

      {/* Right: the icon tray, then date and clock */}
      <div className="flex items-center gap-2">
        {(() => {
          /* Sysop feedback inbox - renders nothing for non-admins */
          const bell = <FeedbackBell position={taskbarPosition === 'bottom' ? 'bottom' : 'top'} />;
          /* ZIM - verified accounts only; renders nothing otherwise */
          const zim = <ZimTray />;
          const glyph = (<>
          {/*
            * Charts / glyphs.
            *
            * In the tray rather than buried in Settings because it is something
            * you flip while looking at a chart to compare the two, not something
            * you configure once - the same reason the icon-style toggle is here.
            */}
          <button
            onClick={handleGenerativeToggle}
            className="tb-ico px-2 py-1 flex items-center"
            title={generative ? 'Show charts as lines' : 'Show charts as glyph reliefs'}
            aria-pressed={generative}
            style={{ fontSize: 'var(--font-size-menu)' }}
          >
            <span className={generative ? 'text-[var(--accent-gold)]' : 'text-[var(--text-primary)]'}>
              {generative ? '⣿' : icon('📈', 'price-chart', 30)}
            </span>
          </button>

          {/*
            * The emoji / ASCII toggle lived here and is HIDDEN, not deleted.
            *
            * The setting still works and is still honoured everywhere; it is the
            * one-click switch that is withdrawn, because the retro set is not yet
            * complete enough for flipping it to be a good experience. Removing
            * `handleRetroToggle` and the store wiring would mean rebuilding both
            * when it comes back, so they stay.
            */}
          </>);
          const music = (<>
          {/* zecAmp: opens the player; glows while it plays. */}
          <button
            onClick={() => { playClick(); openZecamp(); }}
            className={`tb-ico px-2 py-1 flex items-center${zecPlaying ? ' tb-playing' : ''}`}
            title={zecPlaying ? 'zecAmp (playing)' : 'zecAmp'}
            aria-label="Open zecAmp"
            style={{ fontSize: 'var(--font-size-menu)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/zecamp/logo.svg" alt="" width={16} height={16} />
          </button>
          </>);
          const settings = (<>
          {/* Settings */}
          <button
            onClick={() => {
              const meta = APP_REGISTRY.find((a) => a.id === 'settings');
              if (meta) handleOpenApp({
                id: meta.id, type: meta.type, title: meta.title, icon: meta.icon,
                defaultSize: meta.defaultSize, minSize: meta.minSize,
              });
            }}
            data-tour="settings-button"
            className="tb-ico px-2 py-1 flex items-center"
            title="Settings"
            aria-label="Open Settings"
            style={{ fontSize: 'var(--font-size-menu)' }}
          >
            <span className="text-[var(--text-primary)]">{icon('⚙️', undefined, 30)}</span>
          </button>
          </>);
          const coffee = (<>
          {/*
            * Coffee + suggestion box, the same triggers as the desktop's own pair
            * in the bottom-right corner.
            *
            * They live here BECAUSE that corner pair now sits under the windows:
            * it used to float over every open app (and over the marketplace's Buy
            * button), and dropping it behind them would have put the infra fund
            * and the feedback form out of reach whenever a window covered the
            * corner. No shake up here - a tray icon that twitches reads as a
            * fault.
            */}
          <div className="tb-ico px-2 py-1 flex items-center"
            style={{ fontSize: 'var(--font-size-menu)' }}>
            <CoffeeCup variant="inline" animate={false} />
          </div>
          </>);
          const suggest = (<>
          <div className="tb-ico px-2 py-1 flex items-center"
            style={{ fontSize: 'var(--font-size-menu)' }}>
            <FeedbackButton variant="inline" open="window" />
          </div>
          </>);
          const volume = (<>
          {/* Volume control */}
          <div className="relative" ref={volumeRef}>
            <button
              onClick={() => { playClick(); setVolumeOpen(v => !v); }}
              className="tb-ico px-2 py-1 flex items-center"
              title="Volume"
              style={{ fontSize: 'var(--font-size-menu)' }}
            >
              <span className={soundEnabled && volPct > 0 ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)]'}>
                {icon(!soundEnabled || volPct === 0 ? '🔇' : volPct < 40 ? '🔉' : '🔊', undefined, 30)}
              </span>
            </button>

            {volumeOpen && (
              <div
                className="absolute top-full right-0 mt-1 bg-[#1a1a2e] window-border p-3 z-[9999] flex flex-col items-center gap-2"
                style={{ width: '100px' }}
              >
                <span className="text-[var(--accent-gold)]" style={{ fontSize: 'var(--font-size-label)' }}>
                  VOL {volPct}%
                </span>
                {/* Vertical slider - live-bound to the master volume */}
                <div style={{ height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volPct}
                    onChange={e => {
                      const v = Number(e.target.value);
                      if (v > 0 && !soundEnabled) setSoundEnabled(true);
                      setVolume(v / 100);                 // live: masterGain() reads this immediately
                      updatePreview();                    // realtime: tone tracks the level as you drag
                    }}
                    onPointerDown={startPreview}
                    onPointerUp={stopPreview}
                    onPointerLeave={stopPreview}
                    onPointerCancel={stopPreview}
                    onKeyDown={() => { if (!previewRef.current) startPreview(); }}
                    onKeyUp={stopPreview}
                    onBlur={stopPreview}
                    style={{
                      writingMode: 'vertical-lr' as React.CSSProperties['writingMode'],
                      direction: 'rtl',
                      width: '28px',
                      height: '90px',
                      cursor: 'pointer',
                      accentColor: 'var(--accent-gold)',
                    }}
                  />
                </div>
                <button
                  onClick={() => {
                    if (soundEnabled) playClick();
                    setSoundEnabled(!soundEnabled);
                    if (!soundEnabled) setTimeout(() => playClick(), 50);
                  }}
                  className={`btn-window w-full py-1 flex items-center justify-center ${soundEnabled ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)]'}`}
                  style={{ fontSize: 'var(--font-size-menu)' }}
                  title={soundEnabled ? 'Mute' : 'Unmute'}
                  aria-label={soundEnabled ? 'Mute' : 'Unmute'}
                >
                  {icon(soundEnabled ? '🔊' : '🔇')}
                </button>
              </div>
            )}
          </div>
          </>);
          const network = (<>
          {/* Wireless/Connection Status */}
          <div className="relative" ref={wirelessRef}>
            <button
              data-tour="net-button"
              onClick={() => {
                playClick();
                setWirelessPopupOpen(!wirelessPopupOpen);
              }}
              className="tb-ico px-2 py-1 flex items-center gap-1"
              title={maintenance ? 'Part of the network is under maintenance' : 'Network status'}
              style={{ fontSize: 'var(--font-size-menu)' }}
            >
              <span
                className={maintenance ? 'tb-breathe' : undefined}
                style={{ color: maintenance ? 'var(--accent-orange)' : healthColor }}
              >
                {icon(maintenance || !healthy ? '📵' : '📶', undefined, 30)}
              </span>
            </button>

            {/* Wireless Popup */}
            {wirelessPopupOpen && (
              <div
                data-tour="net-flyout"
                className="
                  tb-flyout
                  absolute top-full right-0 mt-1
                  bg-[#1a1a2e]
                  window-border
                  p-3
                  z-[9999]
                "
                style={{ width: '280px' }}
              >
                <div className="mb-3">
                  <h3
                    className="text-[var(--accent-gold)]"
                    style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-icon)' }}
                  >
                    Network Status
                  </h3>
                  <div className="text-[var(--text-muted)]" style={{ fontSize: 'calc(var(--font-size-label) * 0.7)' }}>
                    auto-updates every 30s · price every 60s
                  </div>
                </div>

                {/*
                  * Both chains, first, in one word each. A chain this deployment
                  * does not have is left out entirely - it is not a status.
                  *
                  * "Under maintenance" rather than "down": these nodes go offline
                  * because we are updating them, which is a different thing from a
                  * service that has broken - and it is the difference between
                  * somebody waiting five minutes and somebody giving up.
                  */}
                <div className="mb-3 space-y-1" style={{ fontSize: 'var(--font-size-label)' }}>
                  {CHAIN_ROWS.filter(({ key }) => health.chains[key] !== 'off').map(({ key, label }) => {
                    const state = health.chains[key];
                    const word = CHAIN_WORDS[state];
                    const tone = word.tone === 'ok' ? 'var(--accent-green)'
                      : word.tone === 'warn' ? 'var(--accent-orange)'
                      : 'var(--text-muted)';
                    return (
                      <div key={key} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                          <span aria-hidden className="inline-block rounded-full"
                            style={{
                              width: 6, height: 6, background: tone,
                              boxShadow: word.tone === 'ok' ? `0 0 5px ${tone}` : undefined,
                            }} />
                          {label}
                        </span>
                        <span style={{ color: tone }}>{word.label}</span>
                      </div>
                    );
                  })}
                  {maintenance && (
                    <div className="pt-1 text-[var(--text-muted)]" style={{ fontSize: 'calc(var(--font-size-label) * 0.78)', lineHeight: 1.5 }}>
                      We are updating the node. Nothing is lost - it comes back on its own.
                    </div>
                  )}
                </div>

                <div className="space-y-2 border-t border-[var(--border-window)] pt-2" style={{ fontSize: 'var(--font-size-label)' }}>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--text-secondary)]">Status:</span>
                    <span style={{ color: healthColor }}>
                      {healthy === null ? 'Checking...' : healthy ? 'Connected' : 'Offline'}
                    </span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--text-secondary)]">Latency:</span>
                    <span className={latency !== null && latency < 500 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-orange)]'}>
                      {latency !== null ? `${latency}ms` : '-'}
                    </span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--text-secondary)]">Last Update:</span>
                    <span className="text-[var(--text-primary)]">
                      {lastUpdate ? formatTime(lastUpdate, timeFormat) : '-'}
                    </span>
                  </div>

                  <div className="border-t border-[var(--border-window)] my-2 pt-2">
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--text-secondary)]">Block Height:</span>
                      <span className="text-[var(--accent-green)]">
                        {apiBlockHeight ? `#${apiBlockHeight.toLocaleString()}` : '-'}
                      </span>
                    </div>

                    <div className="flex justify-between gap-4 mt-1">
                      <span className="text-[var(--text-secondary)]">ZEC Price:</span>
                      <span className="text-[var(--accent-green)]">
                        {priceUsd ? `$${priceUsd.toFixed(2)}` : '-'}
                      </span>
                    </div>

                    <div className="flex justify-between gap-4 mt-1">
                      <span className="text-[var(--text-secondary)]">Shielded:</span>
                      <span className="text-[var(--accent-green)]">
                        {apiShieldedPercent !== null ? `${apiShieldedPercent.toFixed(1)}%` : '-'}
                      </span>
                    </div>

                    <div className="flex justify-between gap-4 mt-1">
                      <span className="text-[var(--text-secondary)]">Total Shielded:</span>
                      <span className="text-[var(--accent-green)]">
                        {totalShielded ? `${(totalShielded / 1e6).toFixed(2)}M ZEC` : '-'}
                      </span>
                    </div>

                    {canView && (
                      <div className="flex justify-between gap-4 mt-1" title={nodeSubversion ?? 'Active node architecture'}>
                        <span className="text-[var(--text-secondary)]">Node:</span>
                        <span
                          className="uppercase font-bold"
                          style={{ color: activeNode === 'zakura' ? '#c56b3e' : 'var(--accent-gold)' }}
                        >
                          {activeNode ?? '-'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Upgrades: what is live and what is coming, and a way to check
                      whether your wallet, device or exchange is ready. */}
                  <div className="border-t border-[var(--border-window)] mt-3 pt-2 space-y-1.5">
                    <div className="text-[var(--accent-gold)]" style={{ fontSize: 'calc(var(--font-size-label) * 0.85)' }}>Upgrades</div>
                    {UPGRADES.map((u) => (
                      <div key={u.id} style={{ fontSize: 'calc(var(--font-size-label) * 0.78)', lineHeight: 1.45 }}>
                        <span style={{ color: u.status === 'live' ? 'var(--accent-green)' : '#ffb347' }}>{u.name}</span>
                        <span className="text-[var(--text-muted)]"> {u.line}</span>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        setWirelessPopupOpen(false);
                        useStatusTab.getState().set('readiness');
                        openApp('zcash-status');
                      }}
                      className="btn-window w-full py-1.5 text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/20"
                      style={{ fontSize: 'calc(var(--font-size-label) * 0.85)' }}
                    >
                      Is my wallet ready for NU7? Check anything
                    </button>
                  </div>

                  <div className="border-t border-[var(--border-window)] mt-3 pt-3">
                    <button
                      onClick={() => {
                        setWirelessPopupOpen(false);
                        handleOpenApp(menus.tools.find(t => t.id === 'explorer')!);
                      }}
                      className="btn-window w-full py-2 text-[var(--accent-green)] hover:bg-[var(--accent-gold)]/20"
                      style={{ fontSize: 'var(--font-size-label)' }}
                    >
                      {icon('🔍')} Explore the Network
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          </>);
          if (compact) return (<>
            {bell}{zim}
            <div className="relative" ref={moreRef}>
              <button
                data-tour="tray-more"
                onClick={() => { playClick(); setMoreOpen((v) => !v); }}
                className="btn-window px-2 py-1 flex items-center"
                title="More: charts, music, settings, coffee, suggestions, volume, network"
                aria-label="More taskbar items"
                aria-expanded={moreOpen}
                style={{ fontSize: 'var(--font-size-menu)' }}
              >
                <span className="text-[var(--text-primary)]">☰</span>
              </button>
              {moreOpen && (
                /* A column against the right edge, so each item's own popup still opens on screen. */
                <div data-tour="tray-panel"
                  className="absolute top-full right-0 mt-1 bg-[#1a1a2e] window-border z-[9999] p-2 flex flex-col items-end gap-2">
                  {glyph}{music}{settings}{coffee}{suggest}{volume}{network}
                </div>
              )}
            </div>
          </>);
          /*
           * One tray. Minimised it keeps ZIM, coffee and settings; hovering it
           * drops the rest in a panel snug under the bar. Tray and panel are one
           * hover region (plus a bridge over the bar's padding), closed on a short
           * delay, and held open while a flyout from inside it is open.
           */
          const panelOpen = trayMin && (trayHover || volumeOpen || wirelessPopupOpen);
          const bottom = taskbarPosition === 'bottom';
          return (
            <div ref={trayRef} onPointerEnter={trayEnter} onPointerLeave={trayLeave}>
              <div className="tb-tray">
                <button className="tb-ico tb-arrow" onClick={() => { playClick(); toggleTray(); }}
                  title={trayMin ? 'Show all icons' : 'Minimise the tray'} aria-label={trayMin ? 'Show all icons' : 'Minimise the tray'}
                  aria-expanded={!trayMin}>
                  {trayMin ? '◂' : '▸'}
                </button>
                {trayMin
                  ? <>{zim}{coffee}{settings}</>
                  : <>{bell}{zim}{glyph}{music}{settings}{coffee}{suggest}{volume}{network}</>}
              </div>
              {panelOpen && (
                <div className="tb-tray-panel" style={bottom
                  ? { bottom: '100%', right: trayPos.right, borderBottom: 'none', borderRadius: '3px 3px 0 0' }
                  : { top: '100%', right: trayPos.right, borderTop: 'none', borderRadius: '0 0 3px 3px' }}>
                  <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, height: trayPos.bridge + 2, ...(bottom ? { top: '100%' } : { bottom: '100%' }) }} />
                  {bell}{glyph}{music}{suggest}{volume}{network}
                </div>
              )}
            </div>
          );
        })()}

        {/* Date */}
        <div
          className="text-[var(--text-primary)] px-1 taskbar-date"
          style={{ fontFamily: 'var(--font-primary)', fontSize: 'calc(var(--font-size-clock) * 0.72)' }}
        >
          {formatDate(time, dateFormat)}
        </div>

        {/* Clock */}
        <div
          className="text-[var(--text-secondary)] px-1 taskbar-clock"
          style={{ fontFamily: 'var(--font-primary)', fontSize: 'calc(var(--font-size-clock) * 0.72)' }}
        >
          {formatTime(time, timeFormat)}
        </div>
      </div>
    </div>
  );
}
