import { Theme } from '@/store/themeStore';

export const obsidianTheme: Theme = {
  id: 'obsidian',
  name: 'Obsidian',
  era: 'Modern',
  description: 'Soft dark graphite with gold weight - rounded, borderless, separated by tone rather than lines',

  // Surfaces climb in tone rather than being separated by rules: desktop is the
  // darkest layer, panels sit above it, inset areas above that. Borders are set
  // near-invisible on purpose - depth comes from tone and shadow.
  colors: {
    bgDesktop: '#131318',          // Base layer (graphite, not black)
    bgWindow: '#1c1c23',           // Panel surface
    bgInset: '#262630',            // Raised: inputs, list rows, cards
    bgTitlebar: '#22222b',
    bgTitlebarInactive: '#1c1c23',
    borderLight: '#33333f',        // Only used where a line genuinely helps
    borderDark: '#0d0d11',
    borderWindow: '#1c1c23',       // Matches the panel - effectively borderless
    textPrimary: '#eeecf3',
    textSecondary: '#e8b53a',      // Gold (also maps to legacy --text-amber)
    textMuted: '#9b9bad',          // Lifted for contrast against the lighter base
    accentGold: '#e8b53a',         // Primary accent
    accentGreen: '#3ddc84',        // Semantic (positive / inflow)
    accentOrange: '#ff8a3d',       // Semantic (warning / outflow)
    accentPurple: '#6aa9ff',       // Blue occupies the "electric" slot
    accentBlue: '#6aa9ff',         // Explicit blue highlight → --accent-blue
  },

  fonts: {
    primary: 'Inter, "SF Pro Display", system-ui, sans-serif',
    display: 'Inter, "SF Pro Display", system-ui, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  },
  fontSizes: {
    base: 13,
    scale: 1.1,
  },

  // Generous curvature - nothing in this theme has a hard corner.
  borderRadius: {
    none: '0px',
    small: '12px',
    medium: '18px',
    large: '26px',
  },
  borderStyle: 'modern',

  windowChrome: {
    titlebarHeight: 32,
    buttonStyle: 'flat',
    shadowEnabled: true,
    shadowStyle: '0 8px 32px rgba(0,0,0,0.55)',
  },

  taskbar: {
    height: 54,
    position: 'top',
    logoType: 'image',
    logoImage: '/brand/zec-tile-gold.svg',
    style: 'blur',
  },

  icons: {
    style: 'flat',
  },
};
