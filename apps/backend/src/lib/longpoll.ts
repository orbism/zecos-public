// Tiny in-memory long-poll primitive: a topic carries a monotonic version that
// bumps on every change, and requests can wait on a topic until it bumps (or a
// timeout). Clients send the last version they saw; if it still matches, the
// request is held server-side until something changes - near-instant delivery
// over plain HTTP, no websockets. In-memory / single-instance (fine for one box).

type Waiter = () => void;
const waiters = new Map<string, Set<Waiter>>();
const versions = new Map<string, number>();

export function bump(topic: string) {
  versions.set(topic, (versions.get(topic) ?? 0) + 1);
  const ws = waiters.get(topic);
  if (ws && ws.size) { const list = [...ws]; ws.clear(); for (const w of list) w(); }
}

export function version(topic: string): number {
  return versions.get(topic) ?? 0;
}

// Resolve when the topic bumps or after timeoutMs. Caller re-reads state after.
export function waitForSignal(topic: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(to); waiters.get(topic)?.delete(w); resolve(); };
    const w: Waiter = finish;
    const to = setTimeout(finish, timeoutMs);
    const set = waiters.get(topic) ?? new Set<Waiter>();
    set.add(w); waiters.set(topic, set);
  });
}
