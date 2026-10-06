'use client';

import dynamic from 'next/dynamic';
import XIcon from '@/components/ui/XIcon';
import { CoffeeCup } from '@/components/CoffeeCup/CoffeeCup';
import { FeedbackButton } from '@/components/Feedback/FeedbackButton';

// Polls the chain; no reason to run it during prerender.
const BlockTicker = dynamic(() => import('@/components/Desktop/BlockTicker'), { ssr: false });

export const FOOTER_PX = 48;

/** The ZEC-OS mark, the Gold Tile - the same 16px pixel map as the Start button and the social cards. */
function BoxedZIcon() {
  return <img src="/brand/zec-tile-gold.svg" width={18} height={18} alt="" aria-hidden style={{ imageRendering: 'pixelated', display: 'block' }} />;
}

const linkClass = 'md-state md-body-md flex items-center gap-2 px-3 py-1.5';
const linkStyle: React.CSSProperties = {
  borderRadius: 'var(--md-shape-full)',
  color: 'var(--text-muted)',
};

/**
 * Footer shown on every standalone route.
 *
 * The block ticker takes the leftover space on the left and scrolls inside it
 * (`min-w-0 flex-1`), so it can never grow under the three links on the right
 * no matter how many blocks arrive.
 */
export function StandaloneFooter() {
  return (
    <footer
      className="flex shrink-0 items-center gap-2 px-3 sm:px-4"
      style={{ height: FOOTER_PX }}
    >
      <div
        className="hidden min-w-0 flex-1 items-center overflow-hidden sm:flex"
        style={{
          height: 34,
          borderRadius: 'var(--md-shape-full)',
          background: 'var(--bg-window)',
        }}
      >
        <BlockTicker variant="inline" />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <a
          href="https://zec-os.com"
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          style={linkStyle}
          title="zec-os.com"
        >
          <BoxedZIcon />
          <span className="hidden md:inline">zec-os.com</span>
        </a>

        <a
          href="https://x.com/artoforb"
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          style={linkStyle}
          title="@artoforb on X"
        >
          <XIcon />
          <span className="hidden md:inline">@artoforb</span>
        </a>

        {/* The label lives inside CoffeeCup's own trigger so the whole thing is
            one clickable control, not a button with dead text beside it. */}
        <span
          className="md-state md-body-md flex items-center px-3 py-1.5"
          style={{ ...linkStyle, cursor: 'pointer' }}
          title="Support ZEC-OS"
        >
          <CoffeeCup variant="inline" label="infra & coffee" />
        </span>

        <span
          className="md-state md-body-md flex items-center px-3 py-1.5"
          style={{ ...linkStyle, cursor: 'pointer' }}
          title="Send feedback"
        >
          <FeedbackButton variant="inline" label="feedback" />
        </span>
      </div>
    </footer>
  );
}
