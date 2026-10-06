'use client';

import { FeedbackForm } from '@/components/Feedback/FeedbackForm';

/**
 * Desktop window host for the feedback form - an ordinary app, so it drags,
 * resizes, minimises and stacks like every other window. The standalone routes
 * use `FeedbackModal` instead, where there is no window manager to host it.
 */
export default function Feedback() {
  return (
    <div className="h-full w-full overflow-hidden">
      <FeedbackForm />
    </div>
  );
}
