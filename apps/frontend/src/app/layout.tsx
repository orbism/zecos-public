import type { Metadata, Viewport } from "next";
import { VT323, Press_Start_2P, Atkinson_Hyperlegible_Next, Atkinson_Hyperlegible_Mono, Orbitron } from "next/font/google";
import "./globals.css";
import "../styles/minimal26.css";

const vt323 = VT323({
  weight: "400",
  variable: "--font-vt323",
  subsets: ["latin"],
});

const pressStart = Press_Start_2P({
  weight: "400",
  variable: "--font-press-start",
  subsets: ["latin"],
});

// minimal26: the Braille Institute's typeface, drawn so look-alike characters
// (0/O, 1/l/I) can never be confused - text, and the mono for hashes.
const atkinson = Atkinson_Hyperlegible_Next({
  weight: ["400", "500", "600", "700"],
  variable: "--font-atkinson",
  subsets: ["latin"],
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});
const atkinsonMono = Atkinson_Hyperlegible_Mono({
  weight: ["400", "500", "600"],
  variable: "--font-atkinson-mono",
  subsets: ["latin"],
  // next/font has no metrics table for this new face, so it warned on every build;
  // a plain monospace fallback is all a hash needs
  adjustFontFallback: false,
  fallback: ["ui-monospace", "monospace"],
});

// Zeometry Wars' display face. Not preloaded: only the game asks for it.
const orbitron = Orbitron({
  weight: ["500", "700", "900"],
  variable: "--font-orbitron",
  subsets: ["latin"],
  preload: false,
});

const SITE_DESC = "Retro OS interface for Zcash blockchain data";

/**
 * Absolute base for og:image / og:url. Without it Next emits the dev origin, so
 * every social card would 404 for a crawler in production. Override with
 * NEXT_PUBLIC_SITE_URL if the canonical host ever changes.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://zec-os.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "ZEC-OS",
  description: SITE_DESC,
  icons: {
    icon: "/zec-logo.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "ZEC-OS",
    description: SITE_DESC,
    siteName: "ZEC-OS",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "ZEC-OS" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZEC-OS",
    description: SITE_DESC,
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Inline script to set font size and theme from localStorage before React hydrates
// This prevents flash of wrong styling on page load
const initScript = `
(function() {
  var root = document.documentElement;

  // Font size initialization
  try {
    var settings = localStorage.getItem('zec-os-settings');
    if (settings) {
      var parsed = JSON.parse(settings);
      var fontSize = parsed.state && parsed.state.fontSize;
      if (fontSize && ['small', 'medium', 'large', 'xl'].includes(fontSize)) {
        root.setAttribute('data-font-size', fontSize);
      }
    }
  } catch (e) {}
  if (!root.getAttribute('data-font-size')) {
    root.setAttribute('data-font-size', 'medium');
  }

  // Interface mode (minimal26 lies over the theme), so it never flashes classic first
  try {
    var ui = localStorage.getItem('zec-os-ui-mode');
    var m = ui && JSON.parse(ui).state && JSON.parse(ui).state.mode;
    root.setAttribute('data-ui', m === 'minimal26' ? 'minimal26' : 'classic');
  } catch (e) { root.setAttribute('data-ui', 'classic'); }

  // Theme initialization - set data attributes for CSS before React loads
  try {
    var theme = localStorage.getItem('zec-os-theme');
    if (theme) {
      var parsed = JSON.parse(theme);
      var themeId = parsed.state && parsed.state.currentTheme;
      if (themeId) {
        root.setAttribute('data-theme', themeId);
        // Set default border/button styles based on theme
        if (themeId === 'zenith' || themeId === 'obsidian' || themeId === 'obsidian-light') {
          root.setAttribute('data-border-style', 'modern');
          root.setAttribute('data-button-style', 'flat');
          root.setAttribute('data-taskbar-position', 'top');
          root.setAttribute('data-taskbar-style', 'blur');
        } else if (themeId === 'golden-gate') {
          root.setAttribute('data-border-style', 'beveled');
          root.setAttribute('data-button-style', 'beveled');
          root.setAttribute('data-taskbar-position', 'top');
          root.setAttribute('data-taskbar-style', 'beveled');
        } else if (themeId === 'millennium') {
          root.setAttribute('data-border-style', 'flat');
          root.setAttribute('data-button-style', 'rounded');
          root.setAttribute('data-taskbar-position', 'top');
          root.setAttribute('data-taskbar-style', 'flat');
        } else {
          root.setAttribute('data-border-style', 'retro');
          root.setAttribute('data-button-style', 'pixel');
          root.setAttribute('data-taskbar-position', 'top');
          root.setAttribute('data-taskbar-style', 'retro');
        }
      }
    }
  } catch (e) {}
  if (!root.getAttribute('data-theme')) {
    root.setAttribute('data-theme', 'obsidian');
    root.setAttribute('data-border-style', 'modern');
    root.setAttribute('data-button-style', 'flat');
    root.setAttribute('data-taskbar-position', 'top');
    root.setAttribute('data-taskbar-style', 'blur');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-font-size="medium" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body className={`${vt323.variable} ${pressStart.variable} ${atkinson.variable} ${atkinsonMono.variable} ${orbitron.variable}`}>
        {children}
      </body>
    </html>
  );
}
