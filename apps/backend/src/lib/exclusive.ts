/**
 * Run a background pass unless the previous one with the same key is still
 * going (audit H2). A 90-second reconcile that takes longer than 90 seconds -
 * a slow wallet, a long queue - used to start a second copy on top of the
 * first, doubling the wallet load exactly when it was already struggling.
 */
const running = new Set<string>();

export async function exclusive(key: string, job: () => Promise<void>): Promise<void> {
  if (running.has(key)) return;
  running.add(key);
  try { await job(); } finally { running.delete(key); }
}
