import { APP_META, getStandaloneMode } from '@/config/appMeta';
import { useWindowStore } from '@/store/windowStore';
import { calculateWindowPosition } from '@/utils/windowPlacement';

/**
 * Open (or bring forward) an app by id. On the desktop that is a window; on a
 * standalone page, where there is no window manager, it is that app's own
 * page in a new tab.
 */
export function openApp(id: string): void {
  const meta = APP_META.find((m) => m.id === id);
  if (!meta) return;
  if (typeof window !== 'undefined' && window.location.pathname !== '/') {
    if (getStandaloneMode(meta)) window.open(`/${id}`, '_blank', 'noopener');
    return;
  }
  const ws = useWindowStore.getState();
  const w = ws.windows.find((x) => x.type === id);
  if (w) { ws.focusWindow(w.id); return; }
  ws.openWindow({
    id, type: id, title: meta.title, size: meta.defaultSize, minSize: meta.minSize,
    position: calculateWindowPosition(ws.windows, meta.defaultSize, window.innerWidth, window.innerHeight),
  });
}
