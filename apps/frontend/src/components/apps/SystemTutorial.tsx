'use client';

import { useEffect } from 'react';
import { useTourStore } from '@/store/tourStore';
import { useWindowStore } from '@/store/windowStore';

/**
 * The System Tutorial "app". It has no window of its own to show: opening it
 * from anywhere (desktop, Z menu, Registry, terminal) starts the tour overlay
 * and closes the window that asked, so every launcher works the same way.
 */
export default function SystemTutorial({ windowId }: { windowId?: string }) {
  useEffect(() => {
    useTourStore.getState().start();
    if (windowId) useWindowStore.getState().closeWindow(windowId);
  }, [windowId]);
  return null;
}
