'use client';

import { useState } from 'react';
import { FeedbackModal } from '@/components/Feedback/FeedbackModal';
import { openApp } from '@/lib/openApp';

/**
 * "Spotted something out of date?" for the curated-data apps. Opens the
 * Suggestion Box: its window on the desktop, its overlay on a standalone page.
 */
export function ReportOutdated({ what = 'something out of date' }: { what?: string }) {
  const [modal, setModal] = useState(false);
  const open = () => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') setModal(true);
    else openApp('feedback');
  };
  return (
    <>
      <button
        onClick={open}
        className="text-[var(--text-muted)] hover:text-[var(--accent-gold)] underline underline-offset-2"
        style={{ fontSize: 'calc(var(--font-size-label) * 0.85)' }}
      >
        Spotted {what}? Tell the sysop
      </button>
      {modal && <FeedbackModal onClose={() => setModal(false)} />}
    </>
  );
}
