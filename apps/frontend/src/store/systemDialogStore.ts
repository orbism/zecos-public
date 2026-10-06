import { create } from 'zustand';

// Reusable OS-level modal dialog. Any part of ZEC-OS can raise one (e.g. a
// completed swap). Dialogs queue so concurrent events don't clobber each other.
export interface SystemDialogAction {
  label: string;
  onClick?: () => void;
  primary?: boolean;
}
export interface SystemDialogDetail {
  label: string;
  value: string;
  href?: string;         // renders value as an external link (e.g. Etherscan)
  onClick?: () => void;  // renders value as a button (e.g. open Explorer / copy)
  icon?: string;         // trailing affordance hint, e.g. '↗' or '⧉'
  mono?: boolean;
  strong?: boolean;      // emphasize (e.g. amounts)
}
export interface SystemDialogSpec {
  id: string;
  title: string;
  message: string;
  tone?: 'success' | 'info' | 'warn';
  actions?: SystemDialogAction[];
  details?: SystemDialogDetail[]; // optional labeled rows shown under the message
}

interface SystemDialogState {
  queue: SystemDialogSpec[];
  show: (d: Omit<SystemDialogSpec, 'id'> & { id?: string }) => string;
  dismiss: (id: string) => void;
}

export const useSystemDialogStore = create<SystemDialogState>()((set, get) => ({
  queue: [],
  show: (d) => {
    const id = d.id ?? `dlg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    // De-dupe by id so a repeated event (e.g. same swap) doesn't stack.
    if (get().queue.some((q) => q.id === id)) return id;
    set((s) => ({ queue: [...s.queue, { ...d, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
}));
