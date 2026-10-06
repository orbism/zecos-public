/**
 * Small in-memory sliding-window limiter. Per process, lost on restart - a
 * speed bump against brute force and scripted abuse, not an accounting system.
 *
 *   const limiter = rateLimiter({ windowMs: 60_000, max: 30 });
 *   if (limiter.hit(key)) return 429;
 */
export interface RateLimiter {
  /** Records a hit and returns true when the key is over its limit. */
  hit(key: string): boolean;
}

export function rateLimiter(opts: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();
  return {
    hit(key: string): boolean {
      const now = Date.now();
      // Bound the map: drop idle keys every few windows.
      if (now - lastSweep > opts.windowMs * 4) {
        for (const [k, v] of hits) if (v.length === 0 || now - v[v.length - 1]! > opts.windowMs) hits.delete(k);
        lastSweep = now;
      }
      const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      if (recent.length >= opts.max) { hits.set(key, recent); return true; }
      recent.push(now);
      hits.set(key, recent);
      return false;
    },
  };
}
