/**
 * A request URL as it may appear in a log (audit 5): query strings dropped
 * whole (guest delivery addresses, legacy order keys) and a guest's cut batch
 * key, which is its order id in the path, masked.
 */
export function logUrl(url: string): string {
  const [path, query] = String(url ?? '').split('?');
  return (path ?? '').replace(/\/cut\/[0-9a-f]{16,}(:\d+)?/gi, '/cut/:key') + (query === undefined ? '' : '?[redacted]');
}
