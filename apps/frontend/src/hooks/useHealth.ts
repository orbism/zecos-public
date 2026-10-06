'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { ChainState, Health, ServiceState } from '@/app/api/health/route';

/**
 * The stack's health, shared by every component that asks.
 *
 * One fetch per tab on a slow timer, like the Pools beacon and for the same
 * reason: this is a background fact, not a per-component question, and a timer
 * per caller would turn a status check into load of its own.
 *
 * SILENCE IS NOT AN OUTAGE. Until the first answer arrives, and if a check
 * fails, everything reads as up: a monitoring blip must never paint the app
 * orange and tell people to come back later. Only the endpoint saying a service
 * is down makes it down.
 */

const HEALTHY: Health = {
  ok: true, auth: 'up', chain: 'up', wallet: 'up', affected: [],
  chains: { mainnet: 'up', testnet: 'up' }, at: 0,
};
/** Slow on purpose: an outage lasts minutes, and this is chrome, not a heartbeat. */
const EVERY_MS = 45_000;
/** Once it is down, look a little more often so recovery shows up promptly. */
const EVERY_DOWN_MS = 20_000;

let latest: Health = HEALTHY;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();

function rearm(): void {
  const want = latest.ok ? EVERY_MS : EVERY_DOWN_MS;
  if (timer) clearInterval(timer);
  timer = subs.size ? setInterval(() => void refresh(), want) : null;
}

async function refresh(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const j = await r.json() as Health;
      if (typeof j?.ok === 'boolean') {
        const wasOk = latest.ok;
        latest = j;
        fetchedAt = Date.now();
        if (wasOk !== j.ok) rearm();
      }
    } catch {
      // Unreachable: keep the last answer. Our own fetch failing says more about
      // this browser's connection than about the stack.
    } finally {
      inFlight = null;
      for (const cb of [...subs]) cb();
    }
  })();
  return inFlight;
}

function snapshot(): Health {
  return latest;
}

/** Subscribe to the health signal. Pass false to read without keeping it fresh. */
export function useHealth(live = true): Health {
  const subscribe = useCallback((cb: () => void) => {
    subs.add(cb);
    if (live) {
      if (!fetchedAt) void refresh();
      rearm();
    }
    return () => { subs.delete(cb); rearm(); };
  }, [live]);
  return useSyncExternalStore(subscribe, snapshot, () => HEALTHY);
}

/** What to tell someone, in one sentence, or null when all is well. */
export function maintenanceNote(h: Health): string | null {
  if (h.ok) return null;
  const what = h.affected.length ? h.affected.join(', and ') : 'some services';
  return `We are working on the node behind ZEC-OS, so ${what} are unavailable for a few minutes. `
    + 'Everything else works as normal, nothing is lost, and this clears by itself.';
}

/**
 * How a chain is doing, in words a visitor can act on.
 *
 * "Maintenance", not "down": a node that is being updated is not a service that
 * has failed, and the difference is the whole reason anybody looks at this box.
 */
export const CHAIN_WORDS: Record<ChainState, { label: string; tone: 'ok' | 'warn' | 'off' }> = {
  up: { label: 'Operational', tone: 'ok' },
  busy: { label: 'Catching up', tone: 'warn' },
  // One word, because the panel is 280px wide and "Under maintenance" wrapped
  // onto two lines - which reads as more alarming than it is.
  down: { label: 'Maintenance', tone: 'warn' },
  off: { label: 'Unavailable', tone: 'off' },
};

/** True while either chain is being worked on - what makes the taskbar blink. */
export function chainsUnderMaintenance(h: Health): boolean {
  return h.chains.mainnet === 'down' || h.chains.testnet === 'down';
}

export type { ChainState, Health, ServiceState };
