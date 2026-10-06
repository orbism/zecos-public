'use client';

import { useCallback, useEffect, useState } from 'react';
import { applyThemeToDOM } from '@/store/themeStore';
import { obsidianTheme } from '@/themes/obsidian';
import { obsidianLightTheme } from '@/themes/obsidian-light';

export type StandaloneMode = 'dark' | 'light';

/** Text-scale steps offered by the header's size selector. */
export const FONT_STEPS = [1.0, 1.15, 1.3, 1.5] as const;
export const FONT_STEP_LABELS = ['S', 'M', 'L', 'XL'] as const;

export const STANDALONE_THEME_KEY = 'zec-os-standalone-theme';
export const STANDALONE_FONT_KEY = 'zec-os-standalone-fontstep';

export function readStoredMode(): StandaloneMode {
  try {
    return localStorage.getItem(STANDALONE_THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function readStoredFontStep(): number {
  try {
    const n = Number(localStorage.getItem(STANDALONE_FONT_KEY));
    return Number.isFinite(n) && n >= 0 && n < FONT_STEPS.length ? n : 1;
  } catch {
    return 1;
  }
}

/** Persisted text-scale step. Index into FONT_STEPS. */
export function useFontStep(): { step: number; scale: number; setStep: (i: number) => void } {
  const [step, setStepState] = useState(1);

  useEffect(() => {
    setStepState(readStoredFontStep());
  }, []);

  const setStep = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(FONT_STEPS.length - 1, i));
    setStepState(clamped);
    try { localStorage.setItem(STANDALONE_FONT_KEY, String(clamped)); } catch { /* ignore */ }
  }, []);

  return { step, scale: FONT_STEPS[step], setStep };
}

/**
 * Forces an Obsidian variant for the lifetime of a standalone route.
 *
 * Writes straight to the DOM rather than going through themeStore.setTheme, so
 * the visitor's saved desktop theme is never overwritten. The previous inline
 * values are captured and restored on unmount, which matters for client-side
 * navigation back to `/`.
 */
export function useStandaloneTheme(): { mode: StandaloneMode; toggle: () => void } {
  const [mode, setMode] = useState<StandaloneMode>('dark');

  // Adopt the stored preference on mount (the pre-hydration script in
  // app/[app]/layout.tsx has already set data-theme, so this only syncs React).
  useEffect(() => {
    setMode(readStoredMode());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const prevStyle = root.getAttribute('style');
    const prevTheme = root.getAttribute('data-theme');

    applyThemeToDOM(mode === 'light' ? obsidianLightTheme : obsidianTheme);

    return () => {
      if (prevStyle === null) root.removeAttribute('style');
      else root.setAttribute('style', prevStyle);
      if (prevTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', prevTheme);
    };
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => {
      const next: StandaloneMode = m === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STANDALONE_THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { mode, toggle };
}
