import { create } from 'zustand';

/** Set once the system tour has started on this browser, so it greets a visitor only once. */
export const TOUR_SEEN_KEY = 'zec-os-tour-seen';

/** Whether the system tour is running. The overlay reads it; the System Tutorial app starts it. */
export const useTourStore = create<{ running: boolean; start: () => void; stop: () => void }>((set) => ({
  running: false,
  start: () => {
    try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch { /* private mode: it may greet again */ }
    set({ running: true });
  },
  stop: () => set({ running: false }),
}));
