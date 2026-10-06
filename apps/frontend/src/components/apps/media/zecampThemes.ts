import type { ZecampTheme } from '@/lib/zecamp/engine';

/**
 * Three skins, each an original take on a classic look rather than a copy of
 * one: Baze (the dark grey, green-LCD player everyone remembers), Zento (the
 * later dark modern one, orange on charcoal) and Zucleo (brushed steel, blue
 * glass). Keys stay base/bento/nucleo so saved choices carry over. Every colour zecAmp draws comes from these variables.
 */
export const ZECAMP_THEMES: Record<ZecampTheme, { label: string; vars: Record<string, string> }> = {
  base: {
    label: 'Baze',
    vars: {
      '--zc-frame': 'linear-gradient(180deg, #3b3b52 0%, #2a2a3c 48%, #232333 100%)',
      '--zc-hi': '#5d5d7a', '--zc-lo': '#11111a',
      '--zc-title': 'repeating-linear-gradient(180deg, #c9a24a 0 1px, #6b5320 1px 2px)',
      '--zc-title-fg': '#e8e8f0', '--zc-title-bg': '#2a2a3c',
      '--zc-lcd': '#000000', '--zc-lcd-fg': '#00e000', '--zc-lcd-dim': '#0a5a0a', '--zc-lcd-edge': '#1c1c28',
      '--zc-accent': '#00e000', '--zc-ink': '#c8c8d8',
      '--zc-btn': 'linear-gradient(180deg, #5a5a74 0%, #3a3a50 100%)', '--zc-btn-fg': '#e0e0ec', '--zc-btn-on': '#00e000',
      '--zc-track': '#15151f', '--zc-thumb': 'linear-gradient(180deg, #e9d48a, #a38325)',
      '--zc-list': '#000000', '--zc-list-fg': '#00e000', '--zc-list-cur': '#ffffff', '--zc-list-sel': '#0000c6',
      '--zc-vis-lo': '#00c000', '--zc-vis-hi': '#e8e000', '--zc-vis-top': '#ff3000', '--zc-peak': '#9a9a9a',
      '--zc-radius': '0px', '--zc-font': '"Arial", "Helvetica", sans-serif',
    },
  },
  bento: {
    label: 'Zento',
    vars: {
      '--zc-frame': 'linear-gradient(180deg, #2b2b2b 0%, #1f1f1f 100%)',
      '--zc-hi': '#3a3a3a', '--zc-lo': '#0d0d0d',
      '--zc-title': 'linear-gradient(180deg, #333 0%, #262626 100%)',
      '--zc-title-fg': '#ff9a2e', '--zc-title-bg': '#262626',
      '--zc-lcd': '#141414', '--zc-lcd-fg': '#ff9a2e', '--zc-lcd-dim': '#4a2d0e', '--zc-lcd-edge': '#0a0a0a',
      '--zc-accent': '#ff9a2e', '--zc-ink': '#cfcfcf',
      '--zc-btn': 'linear-gradient(180deg, #3c3c3c 0%, #2a2a2a 100%)', '--zc-btn-fg': '#e6e6e6', '--zc-btn-on': '#ff9a2e',
      '--zc-track': '#101010', '--zc-thumb': 'linear-gradient(180deg, #ffb35e, #e0761a)',
      '--zc-list': '#161616', '--zc-list-fg': '#bdbdbd', '--zc-list-cur': '#ff9a2e', '--zc-list-sel': '#4a3013',
      '--zc-vis-lo': '#b85c0d', '--zc-vis-hi': '#ff9a2e', '--zc-vis-top': '#ffe0b0', '--zc-peak': '#ffffff',
      '--zc-radius': '3px', '--zc-font': '"Segoe UI", "Tahoma", system-ui, sans-serif',
    },
  },
  nucleo: {
    label: 'Zucleo',
    vars: {
      '--zc-frame': 'linear-gradient(180deg, #d9dde3 0%, #aeb4bd 50%, #939aa5 100%)',
      '--zc-hi': '#f4f6f9', '--zc-lo': '#5e6570',
      '--zc-title': 'linear-gradient(180deg, #4d88e0 0%, #1f55a8 100%)',
      '--zc-title-fg': '#ffffff', '--zc-title-bg': '#1f55a8',
      '--zc-lcd': 'linear-gradient(180deg, #0b1a33 0%, #07101f 100%)', '--zc-lcd-fg': '#7fd8ff', '--zc-lcd-dim': '#1d3c5c', '--zc-lcd-edge': '#3f4752',
      '--zc-accent': '#2e6fd6', '--zc-ink': '#1d2430',
      '--zc-btn': 'linear-gradient(180deg, #f2f4f7 0%, #bfc5ce 100%)', '--zc-btn-fg': '#1d2430', '--zc-btn-on': '#2e6fd6',
      '--zc-track': '#6d7580', '--zc-thumb': 'linear-gradient(180deg, #8ec0ff, #2e6fd6)',
      '--zc-list': '#0b1526', '--zc-list-fg': '#9fc9ec', '--zc-list-cur': '#ffffff', '--zc-list-sel': '#244c86',
      '--zc-vis-lo': '#1f6fd0', '--zc-vis-hi': '#7fd8ff', '--zc-vis-top': '#e8fbff', '--zc-peak': '#ffffff',
      '--zc-radius': '4px', '--zc-font': '"Verdana", "Tahoma", sans-serif',
    },
  },
};
