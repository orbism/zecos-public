/**
 * The X logo, as X publishes it.
 *
 * Shared rather than redrawn: it was already a local helper in the standalone
 * footer, and the About credits wanted the same mark. Two copies of a brand
 * glyph is two chances for one of them to drift into being not-quite the logo.
 *
 * `fill: currentColor`, so it takes the colour of whatever it sits in and
 * needs no theme of its own.
 */
export default function XIcon({ size = 17, weight = 0 }: { size?: number; /** Extra stroke, for a heavier mark. */ weight?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false"
      stroke={weight ? 'currentColor' : undefined} strokeWidth={weight || undefined} strokeLinejoin="round">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
