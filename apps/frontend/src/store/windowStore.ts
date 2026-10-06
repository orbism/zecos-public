import { create } from 'zustand';
import { getWorkArea } from '@/utils/workArea';
import { APP_META } from '@/config/appMeta';

export interface WindowState {
  id: string;
  type: string;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize?: { width: number; height: number };
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  flashMessage?: string;
  /**
   * The chain this window was opened against, when it matters.
   *
   * Stamped at open time and NEVER updated afterwards. A window showing testnet
   * data goes on showing testnet data - switching the toggle later opens new
   * windows on the new chain, it does not silently relabel the ones already on
   * screen. The alternative is a window whose title says mainnet while its
   * contents are a test chain, which is the exact confusion the label exists to
   * prevent.
   */
  network?: 'mainnet' | 'testnet';
  /**
   * Put away for the system tour: hidden but still mounted, so its contents
   * survive, and out of the taskbar. Only the tour sets it, and clears it when
   * it ends. Separate from `minimized` so each window comes back exactly as it was.
   */
  parked?: boolean;
}

interface WindowStore {
  windows: WindowState[];
  activeWindowId: string | null;
  nextZIndex: number;

  openWindow: (config: Omit<WindowState, 'zIndex' | 'minimized' | 'maximized'>) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  updatePosition: (id: string, position: { x: number; y: number }) => void;
  updateSize: (id: string, size: { width: number; height: number }) => void;
  updateWindow: (id: string, updates: Partial<WindowState>) => void;
  fitToViewport: () => void;
  cascadeWindows: () => void;
  closeAll: () => void;
  /** Park (or unpark) every open window - see WindowState.parked. */
  parkAll: (on: boolean) => void;

  iconsHidden: boolean;
  toggleIcons: () => void;

  // "Show Desktop" - fly all windows out of sight; any window coming forward
  // (open/focus) or a desktop tap flies them back.
  desktopShown: boolean;
  showDesktop: () => void;
  restoreDesktop: () => void;
}

// Keep a window wholly inside the usable desktop band - below the taskbar,
// above the ticker strip - so its titlebar and its bottom edge are both on
// screen. The band, not the raw viewport: the desktop container has already
// reserved the chrome out of it, and it clips whatever hangs past.
function clampToViewport(pos: { x: number; y: number }, size: { width: number; height: number }) {
  if (typeof window === 'undefined') return pos;
  const { width: availW, height: availH } = getWorkArea();
  const maxX = Math.max(0, availW - Math.min(size.width, availW));
  const maxY = Math.max(0, availH - Math.min(size.height, availH));
  return {
    x: Math.min(Math.max(0, pos.x), maxX),
    y: Math.min(Math.max(0, pos.y), maxY),
  };
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  activeWindowId: null,
  nextZIndex: 1,
  iconsHidden: false,
  desktopShown: false,

  openWindow: (config) => {
    const { windows, nextZIndex } = get();

    // Check if window already exists - focus it, and pull it back into view in
    // case it was parked off-screen (cascading placement can push x/y past the
    // viewport, making a "focused" window invisible).
    if (windows.find(w => w.id === config.id)) {
      get().focusWindow(config.id);
      set((state) => ({
        windows: state.windows.map(w =>
          w.id === config.id
            ? { ...w, position: clampToViewport(w.position, w.size), minimized: false, flashMessage: 'already open - you never left.' }
            : w
        ),
        desktopShown: false,
      }));
      return;
    }

    // An app that docks opens against its edge, whichever launcher opened it.
    if (APP_META.find((a) => a.id === config.type)?.dock === 'right' && typeof window !== 'undefined') {
      const { width } = getWorkArea();
      config = { ...config, position: { x: Math.max(0, width - Math.min(config.size.width, width) - 16), y: 16 } };
    }
    // A centred app (the book) fills most of the desk, front and centre.
    if (APP_META.find((a) => a.id === config.type)?.dock === 'center' && typeof window !== 'undefined') {
      const { width, height } = getWorkArea();
      const w = Math.min(config.size.width, Math.round(width * 0.94)), h = Math.min(config.size.height, Math.round(height * 0.94));
      config = { ...config, size: { width: w, height: h }, position: { x: Math.max(0, Math.round((width - w) / 2)), y: Math.max(0, Math.round((height - h) / 2)) } };
    }

    const newWindow: WindowState = {
      ...config,
      zIndex: nextZIndex,
      minimized: false,
      maximized: false,
    };

    set({
      windows: [...windows, newWindow],
      activeWindowId: config.id,
      nextZIndex: nextZIndex + 1,
      desktopShown: false,
    });
  },

  closeWindow: (id) => {
    set((state) => ({
      windows: state.windows.filter(w => w.id !== id),
      activeWindowId: state.activeWindowId === id ? null : state.activeWindowId,
    }));
  },

  focusWindow: (id) => {
    const { nextZIndex } = get();
    set((state) => ({
      windows: state.windows.map(w =>
        w.id === id ? { ...w, zIndex: nextZIndex, minimized: false } : w
      ),
      activeWindowId: id,
      nextZIndex: nextZIndex + 1,
      desktopShown: false,
    }));
  },

  minimizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map(w =>
        w.id === id ? { ...w, minimized: true } : w
      ),
      activeWindowId: state.activeWindowId === id ? null : state.activeWindowId,
    }));
  },

  maximizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map(w =>
        w.id === id ? { ...w, maximized: true } : w
      ),
    }));
  },

  restoreWindow: (id) => {
    set((state) => ({
      windows: state.windows.map(w =>
        w.id === id ? { ...w, maximized: false } : w
      ),
    }));
  },

  updatePosition: (id, position) => {
    set((state) => ({
      windows: state.windows.map(w =>
        w.id === id ? { ...w, position } : w
      ),
    }));
  },

  updateSize: (id, size) => {
    set((state) => ({
      windows: state.windows.map(w =>
        w.id === id ? { ...w, size } : w
      ),
    }));
  },

  updateWindow: (id, updates) => {
    set((state) => ({
      windows: state.windows.map(w =>
        w.id === id ? { ...w, ...updates } : w
      ),
    }));
  },

  // On a viewport change, shrink any window bigger than the viewport and pull any
  // window that spilled off-screen back into view (keeps the titlebar reachable).
  fitToViewport: () => {
    if (typeof window === 'undefined') return;
    // On mobile every window is render-fullscreen; do NOT clamp stored sizes, or
    // we'd overwrite each app's design width (needed by the zoom-to-fit path).
    if (window.innerWidth <= 640) return;
    // The band the desktop actually draws into - the taskbar and ticker are
    // already subtracted, so no second reserve is owed here.
    const { width: vw, height: vh } = getWorkArea();
    const margin = 8;
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.minimized || w.maximized) return w;
        const minW = w.minSize?.width ?? 240;
        const minH = w.minSize?.height ?? 160;
        const width = Math.max(Math.min(minW, vw - margin * 2), Math.min(w.size.width, vw - margin * 2));
        const height = Math.max(Math.min(minH, vh - margin * 2), Math.min(w.size.height, vh - margin * 2));
        const maxX = Math.max(margin, vw - width - margin);
        const maxY = Math.max(margin, vh - height - margin);
        const x = Math.min(Math.max(margin, w.position.x), maxX);
        const y = Math.min(Math.max(margin, w.position.y), maxY);
        if (width === w.size.width && height === w.size.height && x === w.position.x && y === w.position.y) return w;
        return { ...w, size: { width, height }, position: { x, y } };
      }),
    }));
  },

  // Cascade all open (non-minimized) windows from the top-left, each offset
  // down-and-right so every titlebar stays visible. Restacks z-order too.
  cascadeWindows: () => {
    if (typeof window === 'undefined') return;
    const { width: vw, height: vh } = getWorkArea();
    const startX = 24, startY = 24, stepX = 34, stepY = 32;
    set((state) => {
      const open = state.windows.filter((w) => !w.minimized).sort((a, b) => a.zIndex - b.zIndex);
      let z = state.nextZIndex;
      let x = startX, y = startY, colBase = startX;
      const place = new Map<string, { x: number; y: number; z: number }>();
      for (const w of open) {
        place.set(w.id, { x, y, z: z++ });
        x += stepX; y += stepY;
        if (y + 140 > vh) { colBase += 320; if (colBase + 220 > vw) colBase = startX; x = colBase; y = startY; }
      }
      return {
        nextZIndex: z,
        activeWindowId: open.length ? open[open.length - 1].id : state.activeWindowId,
        windows: state.windows.map((w) => {
          const p = place.get(w.id);
          return p ? { ...w, position: { x: p.x, y: p.y }, zIndex: p.z, maximized: false } : w;
        }),
      };
    });
  },

  // Close every window/app at once (the always-on ticker isn't a window).
  // Parked windows are not on screen, so they are not "all" - the tour's Close
  // All must not throw away what it put aside.
  closeAll: () => set((s) => ({ windows: s.windows.filter((w) => w.parked), activeWindowId: null })),

  parkAll: (on) => set((s) => ({
    windows: s.windows.map((w) => ({ ...w, parked: on || undefined })),
    activeWindowId: on ? null : s.activeWindowId,
  })),

  toggleIcons: () => set((s) => ({ iconsHidden: !s.iconsHidden })),

  showDesktop: () => set({ desktopShown: true }),
  restoreDesktop: () => set((s) => (s.desktopShown ? { desktopShown: false } : s)),
}));
