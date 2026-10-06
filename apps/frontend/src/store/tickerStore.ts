import { create } from 'zustand';

interface TickerStore {
  visible: boolean;
  /**
   * Measured height of the block ticker, in px. 0 when hidden.
   *
   * Published so the desktop can RESERVE the space rather than let the strip
   * float over whatever is underneath. It used to overlay, so the bottom of
   * every window sat behind it and you had to close the ticker to read your own
   * content. Measured rather than assumed because the strip wraps to two rows on
   * narrow screens.
   */
  height: number;
  show: () => void;
  hide: () => void;
  setHeight: (h: number) => void;
}

export const useTickerStore = create<TickerStore>((set) => ({
  visible: true,
  height: 0,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false, height: 0 }),
  // Guard against re-render loops: only write when it actually moved.
  setHeight: (h) => set((s) => (Math.abs(s.height - h) < 1 ? s : { height: h })),
}));
