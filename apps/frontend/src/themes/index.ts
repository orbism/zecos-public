import { Theme } from '@/store/themeStore';
import { crtGreenTheme } from './crt-green';
import { goldenGateTheme } from './golden-gate';
import { millenniumTheme } from './millennium';
import { aquaZecTheme } from './aqua-zec';
import { zenithTheme } from './zenith';
import { lumenTheme } from './lumen';
import { obsidianTheme } from './obsidian';
import { obsidianLightTheme } from './obsidian-light';

// Export individual themes
export { crtGreenTheme } from './crt-green';
export { goldenGateTheme } from './golden-gate';
export { millenniumTheme } from './millennium';
export { aquaZecTheme } from './aqua-zec';
export { zenithTheme } from './zenith';
export { lumenTheme } from './lumen';
export { obsidianTheme } from './obsidian';
export { obsidianLightTheme } from './obsidian-light';

// All available themes - Lumen directly below ZRT Green (default is Obsidian)
export const allThemes: Theme[] = [
  zenithTheme,
  obsidianTheme,
  obsidianLightTheme,
  crtGreenTheme,
  lumenTheme,
  goldenGateTheme,
  millenniumTheme,
  aquaZecTheme,
];

// Theme lookup by ID
export const themesById: Record<string, Theme> = {
  'zenith': zenithTheme,
  'obsidian': obsidianTheme,
  'obsidian-light': obsidianLightTheme,
  'crt-green': crtGreenTheme,
  'lumen': lumenTheme,
  'golden-gate': goldenGateTheme,
  'millennium': millenniumTheme,
  'aqua-zec': aquaZecTheme,
};

// Default theme
export const defaultTheme = obsidianTheme;
