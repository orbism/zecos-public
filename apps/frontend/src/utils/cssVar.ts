/**
 * Resolve a CSS custom property to a concrete colour string.
 *
 * Canvas has no idea what `var(--accent-gold)` means - assigning it to
 * `strokeStyle`/`fillStyle` is silently ignored and the previous colour sticks.
 * uPlot draws entirely to canvas, so every axis/series colour has to be resolved
 * to a real value first.
 */
export function cssVar(name: string, fallback = '#888888'): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Resolved colour with an alpha applied, for fills under a line. */
export function cssVarAlpha(name: string, alpha: number, fallback = '#888888'): string {
  const c = cssVar(name, fallback);
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = c.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((x) => parseFloat(x));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return c;
}

/** Fires whenever the active theme changes, so canvas colours can be re-resolved. */
export function onThemeChange(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  return () => mo.disconnect();
}
