import { Theme } from '@/store/themeStore';

/**
 * Light counterpart to Obsidian. Same Material-3 geometry and type scale, with
 * MD3 light surface roles: a warm neutral background, white elevated surfaces,
 * and accents darkened to hold contrast on light (gold and blue both fail
 * WCAG AA on white at their dark-mode values).
 */
export const obsidianLightTheme: Theme = {
  id: 'obsidian-light',
  name: 'Obsidian Light',
  era: 'Modern',
  description: 'Daylight counterpart to Obsidian - warm neutral surfaces, deep gold, true blue',

  colors: {
    bgDesktop: '#f4f1ec',          // Neutral-95, the page behind surfaces
    bgWindow: '#fdfcfa',           // Surface
    bgInset: '#efece6',            // Surface-container: sunken rows, inputs
    bgTitlebar: '#f7f4ef',         // Surface-container-low
    bgTitlebarInactive: '#efece6',
    borderLight: '#dcd8d0',        // Outline-variant
    borderDark: '#c4c0b8',
    borderWindow: '#fdfcfa',        // Matches the panel - effectively borderless
    textPrimary: '#1b1b1f',        // On-surface
    textSecondary: '#7a5c00',      // Gold, darkened for AA on light
    textMuted: '#5c5f6b',          // On-surface-variant
    accentGold: '#8a6a04',
    accentGreen: '#146c2e',
    accentOrange: '#a63a00',
    accentPurple: '#0b57d0',
    accentBlue: '#0b57d0',         // MD3 primary blue
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

  // MD3 shape scale
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
    shadowStyle: '0 1px 3px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08)',
  },

  taskbar: {
    height: 54,
    position: 'top',
    logoType: 'image',
    logoImage: '/brand/zec-tile-night.svg',
    style: 'blur',
  },

  icons: {
    style: 'flat',
  },
};
