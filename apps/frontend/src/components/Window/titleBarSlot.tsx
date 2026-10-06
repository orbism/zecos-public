'use client';

import { useEffect, useState } from 'react';

/**
 * A place in the window chrome that an app can put one small thing.
 *
 * Both hosts render the slot - the desktop's title bar and the standalone
 * header - under the same id, so an app portals into it without knowing or
 * caring which one it is running inside. That is the whole point: the app says
 * "this belongs in the chrome", and the chrome decides what chrome means here.
 *
 * A portal rather than a prop or a store field because the content is a React
 * node with its own state and fetches. Passing it up through `windowStore`
 * would put a live component tree into a store that is otherwise plain data.
 */
export function titleBarSlotId(windowId: string): string {
  return `titlebar-slot-${windowId}`;
}

/** Rendered by the HOST, in its title bar. */
export function TitleBarSlot({ windowId, style }: { windowId: string; style?: React.CSSProperties }) {
  return (
    <span
      id={titleBarSlotId(windowId)}
      className="inline-flex shrink-0 items-center"
      /* The desktop titlebar is the drag handle. Guarded here rather than in
         every app that portals in, because forgetting it turns a click on a
         control into a window drag - and the app cannot see that it is the
         handle it is sitting on. */
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={style}
    />
  );
}

/**
 * Used by the APP, to find the slot to portal into.
 *
 * One lookup, no polling: the host's title bar and the app render in the same
 * commit, and the DOM is complete before any effect runs. Null when there is no
 * host - a `/pool/<id>` page, a test - and callers render nothing rather than
 * falling back to some other corner.
 */
export function useTitleBarSlot(windowId?: string): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!windowId) { setEl(null); return; }
    setEl(document.getElementById(titleBarSlotId(windowId)));
  }, [windowId]);
  return el;
}
