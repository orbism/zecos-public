/**
 * Headers every server-side call to the Fastify backend carries.
 *
 * The backend never sees the browser: it sees this proxy, which on Vercel is
 * an AWS function, arriving through the Cloudflare tunnel. Every address it
 * could read off the connection - the socket, `cf-connecting-ip`, the
 * left end of `x-forwarded-for` - is therefore the proxy's own egress, which
 * is how the sysop roster came to show AWS EC2 addresses for people on home
 * connections. So the proxy says who the browser is, explicitly, in
 * `x-real-ip`, and proves it is the proxy with the shared secret.
 *
 * Vercel sets `x-vercel-forwarded-for` and `x-real-ip` itself and overwrites
 * whatever the client sent, so these cannot be forged from the browser.
 *
 * IT TRAVELS UNDER OUR OWN HEADER NAME. Measured 2026-09-22 on production:
 * this proxy sent `x-real-ip` and the backend received only cf-connecting-ip,
 * cf-ray and x-forwarded-for - Cloudflare strips or normalises the well-known
 * ones in transit, and both survivors carry THIS proxy's egress rather than the
 * browser. `x-zec-proxy-secret` arrives intact over the same hop, so a
 * namespaced header is what gets through. `x-real-ip` is still sent for the
 * paths with no Cloudflare in them.
 */
export function clientIpOf(req: Request): string {
  const h = req.headers;
  const first = (v: string | null) => v?.split(',')[0]?.trim() || '';
  /*
   * `cf-connecting-ip` is in the list because this app is not always behind
   * Vercel. Served from a box behind the Cloudflare tunnel, there is no
   * x-vercel-forwarded-for at all, and Cloudflare writes the browser's address
   * into cf-connecting-ip (it overwrites whatever arrived, so it cannot be
   * forged). Without it the proxy named nobody, the backend stored nothing, and
   * the sysop roster showed blank IPs.
   */
  return first(h.get('x-vercel-forwarded-for'))
    || first(h.get('x-real-ip'))
    || first(h.get('cf-connecting-ip'))
    || first(h.get('x-forwarded-for'));
}

/**
 * The browser's IP and the proxy secret, ready to spread into a fetch's
 * headers. Pass `req` whenever there is one; without it (a server render with
 * no browser behind it) only the secret is sent.
 */
let lastNoIpWarn = 0;
export function proxyHeaders(req?: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const ip = req ? clientIpOf(req) : '';
  if (ip) { out['x-zec-client-ip'] = ip; out['x-real-ip'] = ip; }
  else if (req) {
    /*
     * Nothing to name the browser with, so the backend records no IP and the
     * sysop roster goes blank. Which header SHOULD have been there depends on
     * what is in front of this app - Vercel, the Cloudflare tunnel, a reverse
     * proxy - so the names that did arrive are the whole diagnosis. Names only,
     * never values, and at most once a minute.
     */
    const now = Date.now();
    if (now - lastNoIpWarn > 60_000) {
      lastNoIpWarn = now;
      const candidates = ['x-vercel-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'x-forwarded-for', 'forwarded', 'true-client-ip'];
      const present = candidates.filter((h) => req.headers.get(h));
      console.warn(`[proxy] no client IP to forward; headers present: ${present.join(', ') || 'none of the usual ones'}`);
    }
  }
  const secret = process.env.PROXY_SHARED_SECRET?.trim();
  if (secret) out['x-zec-proxy-secret'] = secret;
  return out;
}
