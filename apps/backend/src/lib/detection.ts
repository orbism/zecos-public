import type { BackendNetwork } from '../wallet/zallet';

/**
 * Payment detection that does not flap, and does not leak.
 *
 * A wallet RPC blocks briefly during reorg handling and rescans, so a single
 * failure says almost nothing: in one three-hour window 108 checks failed
 * across both wallets and every one of them succeeded on the next call. Two
 * rules follow from that, and one from what those failures contained.
 *
 *  - Retry once. A check that fails is tried again after two seconds before
 *    anyone is told anything.
 *  - Hold the last good answer. If this network answered within the last
 *    minute, a failure now is a blip: the poll keeps saying "watching".
 *  - Never hand the exception to the client. The message carries container
 *    names and command lines. The client gets one fixed sentence; the real
 *    error goes to the log with the order id.
 */

/** The only detection text a client ever sees. */
export const DETECTION_NOTE =
  'We can’t confirm payments right now. Your invoice is still valid and will settle once we can see the chain again.';

/** How long a good answer covers for a failing one. */
const HOLD_MS = 60_000;
/** Between the failed check and its retry. */
const RETRY_MS = 2_000;

const lastGood = new Map<BackendNetwork, number>();

export function markDetectionGood(net: BackendNetwork): void {
  lastGood.set(net, Date.now());
}

/** Did this network's wallet answer recently enough to ride out a failure now? */
export function detectionHolds(net: BackendNetwork): boolean {
  const at = lastGood.get(net);
  return at !== undefined && Date.now() - at < HOLD_MS;
}

/**
 * Run `probe`, and on failure run it once more after RETRY_MS. Marks the
 * network good when either attempt succeeds; the second failure is thrown to
 * the caller, which decides what to say.
 */
export async function detect<T>(net: BackendNetwork, probe: () => Promise<T>): Promise<T> {
  try {
    const first = await probe();
    markDetectionGood(net);
    return first;
  } catch {
    await new Promise((r) => setTimeout(r, RETRY_MS));
    const second = await probe();
    markDetectionGood(net);
    return second;
  }
}
