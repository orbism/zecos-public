'use client';

import { useEffect, useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useTickerStore } from '@/store/tickerStore';

/**
 * The usable desktop rectangle, in the window layer's OWN coordinates - the
 * origin is the top-left of the <Desktop> container, not of the viewport.
 *
 * The desktop reserves the taskbar and the block ticker out of the viewport, so
 * a window sized or placed against `window.innerHeight` overflows that
 * container and gets clipped: its bottom edge, and anything the app anchors
 * there (a Buy button, a form's submit row), disappears under the footer strip.
 * One place computes the band that every placement path then agrees on.
 *
 * Both taskbar positions subtract the same amount - only which edge it comes
 * off changes, and the container has already applied that.
 */
function band(vw: number, vh: number, taskbarHeight: number, ticker: number) {
  return {
    width: vw,
    // Never report a band so short a window cannot show its titlebar.
    height: Math.max(160, vh - taskbarHeight - ticker),
  };
}

/** Imperative read, for placement maths outside of render. */
export function getWorkArea(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1200, height: 800 };
  const theme = useThemeStore.getState().getTheme();
  const t = useTickerStore.getState();
  return band(
    window.innerWidth,
    window.innerHeight,
    theme?.taskbar?.height || 54,
    t.visible ? t.height : 0,
  );
}

/**
 * Reactive read, for anything that has to re-lay-out when the band moves -
 * a taller taskbar, the ticker being shown or hidden, the viewport resizing.
 */
export function useWorkArea(): { width: number; height: number } {
  const taskbarHeight = useThemeStore((s) => s.getTheme()?.taskbar?.height || 54);
  const tickerVisible = useTickerStore((s) => s.visible);
  const tickerHeight = useTickerStore((s) => s.height);

  const [vp, setVp] = useState(() =>
    typeof window === 'undefined'
      ? { w: 1200, h: 800 }
      : { w: window.innerWidth, h: window.innerHeight },
  );

  useEffect(() => {
    const onResize = () => setVp((p) =>
      p.w === window.innerWidth && p.h === window.innerHeight
        ? p
        : { w: window.innerWidth, h: window.innerHeight },
    );
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return band(vp.w, vp.h, taskbarHeight, tickerVisible ? tickerHeight : 0);
}
