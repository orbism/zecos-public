import { WindowState } from '@/store/windowStore';
import { getWorkArea } from './workArea';

const CASCADE_OFFSET_X = 60;
const CASCADE_OFFSET_Y = 50;
const START_X = 40;
const START_Y = 50;

/**
 * Where a newly opened window goes: cascaded off the last one, and ALWAYS
 * wholly inside the usable desktop band.
 *
 * It used to cascade against the raw viewport minus a hardcoded 32px taskbar,
 * which is neither the real taskbar height nor the real band - the block ticker
 * is carved out too. A window placed against the viewport hangs past the
 * bottom of the clipping container, so its footer (a Buy button, a form's
 * submit row) is simply gone, and a tall one could be pushed down far enough to
 * take its own titlebar with it.
 */
export function calculateWindowPosition(
  existingWindows: WindowState[],
  newSize: { width: number; height: number },
  /*
   * Call sites used to hand in `window.innerWidth/innerHeight`. The viewport is
   * not the work area, so the band is measured here instead; the arguments are
   * accepted and ignored rather than churned through two dozen call sites.
   */
  ..._viewport: number[]
): { x: number; y: number } {
  const { width: availW, height: availH } = getWorkArea();

  // A window wider or taller than the band is displayed capped to it, so bound
  // the position against what will actually be drawn.
  const width = Math.min(newSize.width, availW);
  const height = Math.min(newSize.height, availH);
  const maxX = Math.max(0, availW - width);
  const maxY = Math.max(0, availH - height);

  const visibleWindows = existingWindows.filter(w => !w.minimized && !w.parked);

  let newX = START_X;
  let newY = START_Y;

  if (visibleWindows.length > 0) {
    const lastWindow = visibleWindows[visibleWindows.length - 1];
    newX = lastWindow.position.x + CASCADE_OFFSET_X;
    newY = lastWindow.position.y + CASCADE_OFFSET_Y;

    // Wrapped past the band - restart from the top-left with a small offset so
    // the new window doesn't land exactly on an existing one.
    if (newX > maxX || newY > maxY) {
      const offset = (visibleWindows.length % 5) * 30;
      newX = START_X + offset;
      newY = START_Y + offset;
    }
  }

  return {
    x: Math.max(0, Math.min(newX, maxX)),
    y: Math.max(0, Math.min(newY, maxY)),
  };
}
