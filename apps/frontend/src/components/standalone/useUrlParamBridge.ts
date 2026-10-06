'use client';

import { useEffect, useRef, useState } from 'react';
import { useExplorerStore } from '@/store/explorerStore';

/** The only apps whose params can't be resolved from the URL alone. */
const NEEDS_BLOCK_FETCH = new Set(['block-map', 'chain-pulse']);

/**
 * Bridges URL query params into the explorerStore mailbox that param-consuming
 * apps already read on mount (`consumeAction(windowId)`).
 *
 * Inside the desktop those params are queued by whichever app spawned the
 * window. Standalone there is no spawner, so the URL plays that role - with no
 * changes to the apps themselves.
 *
 *   /explorer?q=<txid|address|height>[&type=transaction]
 *   /tx-graph?txid=<txid>
 *   /ua-decoder?q=<address>
 *   /block-map?height=<n>      ← needs a block fetch (tx list, time, size)
 *   /chain-pulse?height=<n>    ← ditto
 *
 * Timing: apps consume their action exactly once in a mount-only effect, and
 * React runs child effects BEFORE the parent's. So the synchronous seeds happen
 * during render (ref-guarded, idempotent) rather than in an effect - seeding
 * afterwards would always be too late. Only the block-fetch cases return
 * `false`, holding the app's mount until the fetch lands.
 *
 * Reads `window.location.search` rather than `useSearchParams` on purpose:
 * these routes are statically generated, and `useSearchParams` would force the
 * whole shell to bail to a Suspense fallback at build time, stripping the
 * header, footer and app body out of the prerendered HTML.
 */
export function useUrlParamBridge(appId: string, windowId: string): boolean {
  const needsFetch = NEEDS_BLOCK_FETCH.has(appId);
  const [ready, setReady] = useState(!needsFetch);
  const seeded = useRef(false);

  // Synchronous seeds - during render, before any child effect can consume.
  if (!seeded.current && !needsFetch && typeof window !== 'undefined') {
    seeded.current = true;
    const params = new URLSearchParams(window.location.search);
    const store = useExplorerStore.getState();
    const q = params.get('q')?.trim();
    const txid = params.get('txid')?.trim();

    if ((appId === 'explorer' || appId === 'ua-decoder') && q) {
      const type = (params.get('type') ?? 'auto') as
        | 'block' | 'transaction' | 't-address' | 'z-address' | 'auto';
      store.queueSearch(windowId, q, type);
    } else if (appId === 'tx-graph' && txid) {
      store.queueTxGraph(windowId, txid);
    }
  }

  // Async seed - block-map / chain-pulse need the block's tx list, time and size.
  useEffect(() => {
    if (!needsFetch) return;
    const height = new URLSearchParams(window.location.search).get('height')?.trim();
    if (!height) {
      setReady(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/block/${encodeURIComponent(height)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const block = raw.result ?? raw.data ?? raw;
        const ctx = {
          blockHeight: Number(block.height),
          blockHash: String(block.hash ?? ''),
          transactions: (block.tx ?? block.transactions ?? []) as string[],
          time: Number(block.time ?? 0),
        };
        if (cancelled) return;
        const store = useExplorerStore.getState();
        if (appId === 'block-map') {
          store.queueBlockMap(windowId, { ...ctx, size: Number(block.size ?? 0) });
        } else {
          store.queueChainPulse(windowId, ctx);
        }
      } catch {
        // Fall through - the app renders its own "nothing selected" state.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appId, windowId, needsFetch]);

  return ready;
}
