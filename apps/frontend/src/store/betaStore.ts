'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { APP_META } from '@/config/appMeta';
import { useCanViewAdmin } from '@/store/authStore';

/**
 * Beta apps: which ones the sysop has switched live for everyone.
 *
 * A beta app always opens. Switched off, the public sees a preview on sample
 * data (how it works, never live data); the sysop and sudobuds see it live
 * anyway, so it can be tested before it is switched on. Anything the backend
 * cannot answer reads as "off": a failure can only put apps back into preview.
 */
interface BetaState {
  enabled: Record<string, boolean>;
  status: 'loading' | 'ok' | 'offline';
  load: () => Promise<void>;
  /** Sysop: flip one or more apps. Resolves to an error message, or null. */
  save: (patch: Record<string, boolean>, token: string) => Promise<string | null>;
}

export const useBetaStore = create<BetaState>((set, get) => ({
  enabled: {},
  status: 'loading',
  load: async () => {
    try {
      const r = await fetch('/api/beta', { cache: 'no-store' });
      const d = await r.json() as { enabled?: Record<string, boolean>; offline?: boolean };
      set({ enabled: d.enabled ?? {}, status: d.offline ? 'offline' : 'ok' });
    } catch { set({ status: 'offline' }); }
  },
  save: async (patch, token) => {
    const before = get().enabled;
    set({ enabled: { ...before, ...patch } });
    try {
      const r = await fetch('/api/beta/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: patch }),
      });
      const d = await r.json().catch(() => ({})) as { enabled?: Record<string, boolean>; error?: string };
      if (!r.ok || !d.enabled) { set({ enabled: before }); return d.error ?? `Save failed (${r.status})`; }
      set({ enabled: d.enabled, status: 'ok' });
      return null;
    } catch { set({ enabled: before }); return 'Backend unreachable'; }
  },
}));

let users = 0, stop: (() => void) | null = null;
function useBetaLoader() {
  useEffect(() => {
    if (users++ === 0) {
      const load = () => void useBetaStore.getState().load();
      load();
      const id = setInterval(load, 60_000);
      window.addEventListener('focus', load);
      stop = () => { clearInterval(id); window.removeEventListener('focus', load); };
    }
    return () => { if (--users === 0) { stop?.(); stop = null; } };
  }, []);
}

const BETA_IDS = new Set(APP_META.filter((a) => a.beta).map((a) => a.id));
const OPEN_IDS = new Set(APP_META.filter((a) => a.beta && a.betaOpen).map((a) => a.id));
export const isBetaApp = (id: string | undefined) => !!id && BETA_IDS.has(id);

export interface BetaView {
  /** The app is marked beta at all. */
  beta: boolean;
  /** Switched live for everyone. */
  on: boolean;
  /** This viewer gets live data: switched on, or the sysop / a sudobud testing it. */
  live: boolean;
  /** Live only because this viewer is staff. */
  staffPreview: boolean;
  /** Tagged beta but never gated (betaOpen): no sysop switch. */
  open: boolean;
}

/** How a beta app should behave for whoever is looking at it right now. */
export function useBeta(appId: string): BetaView {
  useBetaLoader();
  const on = useBetaStore((s) => !!s.enabled[appId]);
  const staff = useCanViewAdmin();
  const beta = BETA_IDS.has(appId);
  if (!beta) return { beta: false, on: true, live: true, staffPreview: false, open: true };
  if (OPEN_IDS.has(appId)) return { beta, on: true, live: true, staffPreview: false, open: true };
  return { beta, on, live: on || staff, staffPreview: !on && staff, open: false };
}
