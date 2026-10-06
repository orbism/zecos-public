'use client';

import { AppGlyph } from '@/components/ui/ZecIcon';
import { useState } from 'react';
import { FeedbackModal } from './FeedbackModal';
import { getApp } from '@/config/appRegistry';
import { useWindowStore } from '@/store/windowStore';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { useChromeInsets } from '@/hooks/useChromeInsets';

const WINDOW_ID = 'feedback';

/**
 * Trigger for the feedback form.
 *
 * `open`:
 *   'window' - desktop. Opens the real `feedback` app so it drags, resizes and
 *              stacks like anything else; re-clicking focuses the open one.
 *   'modal'  - standalone routes, where there is no window manager. Portalled
 *              blocking overlay.
 *
 * `variant` only controls the trigger's own placement: `floating` pins it left
 * of the desktop's coffee cup, `inline` lets a container (the standalone
 * footer) place it.
 */
export function FeedbackButton({
  variant = 'floating',
  label,
  open: mode = 'modal',
}: {
  variant?: 'floating' | 'inline';
  label?: string;
  open?: 'window' | 'modal';
} = {}) {
  const [modalOpen, setModalOpen] = useState(false);

  const { floatingBottom } = useChromeInsets();
  const handleClick = () => {
    if (mode === 'modal') { setModalOpen(true); return; }

    const { windows, openWindow, focusWindow } = useWindowStore.getState();
    if (windows.some((w) => w.id === WINDOW_ID)) { focusWindow(WINDOW_ID); return; }

    const cfg = getApp('feedback');
    const size = cfg?.defaultSize ?? { width: 480, height: 640 };
    openWindow({
      id: WINDOW_ID,
      type: 'feedback',
      title: cfg?.title ?? 'Suggestion Box',
      position: calculateWindowPosition(windows, size, window.innerWidth, window.innerHeight),
      size,
      minSize: cfg?.minSize,
    });
  };

  return (
    <>
      <style>{`
        .feedback-btn { transition: filter 0.15s; }
        .feedback-btn:hover { filter: brightness(1.4) drop-shadow(0 0 8px rgba(85,255,255,0.7)); }
      `}</style>

      <button
        className="feedback-btn"
        onClick={handleClick}
        title="Send feedback, a bug report, or an idea 📮"
        style={
          variant === 'inline'
            ? {
                background: 'none', border: 'none', padding: 0,
                fontSize: '17px', lineHeight: 1, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                color: 'inherit', font: 'inherit',
              }
            : {
                /*
                 * Clear of the ticker, and clear of the coffee cup.
                 *
                 * The cup sits at right:28 and draws about 34px wide, so
                 * right:66 left them almost touching. 88 gives an honest gap.
                 */
                // Below the window layer, for the same reason as the cup: it
                // was covering the apps it sits over, the marketplace's Buy
                // button included. The taskbar carries a copy.
                position: 'fixed', bottom: floatingBottom, right: 88, zIndex: 5,
                background: 'none', border: 'none', padding: 0,
                fontSize: '34px', lineHeight: 1, cursor: 'pointer',
                filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.7))',
              }
        }
      >
        {/*
          * The button asked for 34px and this span overrode it with 17, so the
          * glyph rendered at half the size of the coffee cup beside it. Inline
          * keeps its own 17px; floating now matches its container.
          */}
        <span style={{ fontSize: variant === 'inline' ? '17px' : '28px', lineHeight: 1 }}><AppGlyph id="feedback" size={variant === 'inline' ? 28 : 36} /></span>
        {variant === 'inline' && label ? <span>{label}</span> : null}
      </button>

      {modalOpen && <FeedbackModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
