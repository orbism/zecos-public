import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * How each folder window lays out its apps, remembered per folder: one folder
 * can sit in a compact list while another keeps big icons.
 */
export type FolderMode = 'icons' | 'list';
export type FolderSort = 'az' | 'za';
export type IconSize = 'sm' | 'md' | 'lg';

export interface FolderView {
  mode: FolderMode;
  sort: FolderSort;
  size: IconSize;
  /** List view: the one-line description beside each app. */
  desc: boolean;
  /** Beta apps grouped at the end instead of mixed in. */
  betaLast: boolean;
}

export const DEFAULT_VIEW: FolderView = { mode: 'icons', sort: 'az', size: 'md', desc: true, betaLast: false };

interface FolderViewState {
  views: Record<string, Partial<FolderView>>;
  set: (folder: string, patch: Partial<FolderView>) => void;
  reset: (folder: string) => void;
}

export const useFolderViewStore = create<FolderViewState>()(
  persist(
    (set) => ({
      views: {},
      set: (folder, patch) => set((s) => ({ views: { ...s.views, [folder]: { ...s.views[folder], ...patch } } })),
      reset: (folder) => set((s) => { const views = { ...s.views }; delete views[folder]; return { views }; }),
    }),
    { name: 'zec-os-folder-view' },
  ),
);

export function useFolderView(folder: string): FolderView {
  const v = useFolderViewStore((s) => s.views[folder]);
  return { ...DEFAULT_VIEW, ...v };
}
