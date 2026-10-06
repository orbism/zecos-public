import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useWindowStore } from './windowStore';

/**
 * The interface mode, laid OVER the chosen theme rather than replacing it.
 *
 * `classic` is whatever theme the user picked. `minimal26` is the
 * readability layer: Atkinson Hyperlegible, larger type, quiet borders,
 * sections alternating graphite and navy, and room to breathe. Switching
 * back restores the theme exactly, because the theme was never touched:
 * the layer is CSS keyed on `<html data-ui="...">`.
 *
 * A union rather than a boolean: a third mode (a futuristic terminal for
 * the hardcore) is planned, and it slots in here.
 */
export type UiMode = 'classic' | 'minimal26';

export const UI_MODE_KEY = 'zec-os-ui-mode';
/** How much bigger open windows get in minimal26, so the larger type still fits. */
const GROW = 1.12;

interface UiModeState {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
}

function applyModeToDOM(mode: UiMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-ui', mode);
}

/** Grow (or shrink back) every open window, kept on screen. */
function rescaleWindows(k: number) {
  if (typeof window === 'undefined') return;
  const { windows, updateWindow } = useWindowStore.getState();
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const w of windows) {
    if (w.maximized) continue;
    const width = Math.min(Math.round(w.size.width * k), vw - 16);
    const height = Math.min(Math.round(w.size.height * k), vh - 80);
    const x = Math.max(0, Math.min(w.position.x - Math.round((width - w.size.width) / 2), vw - width));
    const y = Math.max(0, Math.min(w.position.y, vh - height - 60));
    updateWindow(w.id, { size: { width, height }, position: { x, y } });
  }
}

export const useUiModeStore = create<UiModeState>()(
  persist(
    (set, get) => ({
      mode: 'classic',
      setMode: (mode) => {
        const was = get().mode;
        if (mode === was) return;
        set({ mode });
        applyModeToDOM(mode);
        if (mode === 'minimal26') rescaleWindows(GROW);
        else if (was === 'minimal26') rescaleWindows(1 / GROW);
      },
    }),
    {
      name: UI_MODE_KEY,
      onRehydrateStorage: () => (state) => { if (state) applyModeToDOM(state.mode); },
    },
  ),
);
