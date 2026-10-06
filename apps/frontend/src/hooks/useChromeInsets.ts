'use client';

import { useThemeStore } from '@/store/themeStore';
import { useTickerStore } from '@/store/tickerStore';

/**
 * How much furniture sits at the bottom of the screen, and where each piece of
 * it starts.
 *
 * Everything anchored to the bottom-right used to hardcode `bottom: 58px` - a
 * guess at the taskbar height with a few pixels added. That guess went wrong the
 * moment the block ticker appeared beneath it, and it would go wrong again for
 * any theme with a taller taskbar. One place to compute it, read by everything
 * that needs it.
 *
 * The taskbar can be at the top, in which case nothing is reserved for it at the
 * bottom and the ticker sits on the floor.
 */
export function useChromeInsets() {
  const getTheme = useThemeStore((s) => s.getTheme);
  const theme = getTheme();
  const taskbarHeight = theme?.taskbar?.height || 54;
  const taskbarAtBottom = (theme?.taskbar?.position || 'top') === 'bottom';

  const tickerVisible = useTickerStore((s) => s.visible);
  const tickerHeight = useTickerStore((s) => s.height);

  /** Where the ticker's own bottom edge sits. */
  const tickerBottom = taskbarAtBottom ? taskbarHeight : 0;
  /** Everything the ticker occupies, when it is showing. */
  const tickerBand = tickerVisible ? tickerHeight : 0;

  return {
    taskbarHeight,
    taskbarAtBottom,
    tickerVisible,
    tickerHeight,
    tickerBottom,
    /**
     * The floor for floating bottom-right controls: clear of the taskbar AND of
     * the ticker, so they sit north of the strip rather than on top of it.
     */
    floatingBottom: tickerBottom + tickerBand + 12,
  };
}
