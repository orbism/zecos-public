/* Public build: usage metrics are not part of this distribution. */
export type ClientApi = Record<string, [number, number, number, number]>;
export function parseClientApi(_raw: unknown): ClientApi | null { return null; }
export function recordBeat(..._a: unknown[]): void {}
export function recordEndpoint(..._a: unknown[]): void {}
export function recordUpstream(..._a: unknown[]): void {}
export async function timed<T>(_service: string, _method: string, fn: () => Promise<T>): Promise<T> { return fn(); }
export function startMetrics(): void {}
export async function flushMetrics(): Promise<void> {}
