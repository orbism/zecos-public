'use client';

import { useRef, useState } from 'react';
import { useDismiss } from './useDismiss';
import { AppGlyph } from '@/components/ui/ZecIcon';

export interface TitleMenuAction {
  label: string;
  hint?: string;
  icon: string;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * The app title doubles as a menu button.
 *
 * Navigation back to ZEC-OS lives on the separate back arrow beside it - the
 * title itself is for acting on the app you're already looking at.
 */
export function StandaloneTitleMenu({
  title,
  icon,
  logo,
  appId,
  actions,
}: {
  title: string;
  icon: string;
  /** Path to the app's mark, when it has one. */
  logo?: string;
  /** The app, for its ZEC-OS mark. */
  appId?: string;
  actions: TitleMenuAction[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(wrapRef, open, setOpen);

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="md-state flex min-w-0 max-w-full items-center gap-2 py-2 pr-2 pl-2 sm:gap-2.5 sm:pr-3 sm:pl-3"
        style={{ borderRadius: 'var(--md-shape-full)', color: 'var(--text-primary)' }}
        title="App options"
      >
        {/* A real mark where the app has one; the glyph otherwise. */}
        {appId
          ? <AppGlyph id={appId} glyph={icon} size={22} />
          : logo
          ? <img src={logo} alt="" width={22} height={22} style={{ borderRadius: 5, display: 'block' }} />
          : <span aria-hidden style={{ fontSize: 21, lineHeight: 1 }}>{icon}</span>}
        <h1 className="md-title-lg min-w-0 truncate">{title}</h1>
        <span
          aria-hidden
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--md-dur-short) var(--md-ease-standard)',
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-2 w-72 overflow-hidden p-1.5"
          style={{
            borderRadius: 'var(--md-shape-md)',
            background: 'var(--bg-window)',
            border: '1px solid var(--border-window)',
            boxShadow: 'var(--md-elev-3)',
            animation: 'mdMenuIn var(--md-dur-medium) var(--md-ease-emphasized)',
          }}
        >
          <style>{`
            @keyframes mdMenuIn {
              from { opacity: 0; transform: translateY(-6px) scale(0.98); }
              to   { opacity: 1; transform: translateY(0)    scale(1); }
            }
          `}</style>

          {actions.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                a.onSelect();
                setOpen(false);
              }}
              className="md-state flex w-full items-start gap-2.5 px-3 py-2 text-left disabled:pointer-events-none disabled:opacity-40"
              style={{ borderRadius: 'var(--md-shape-sm)', color: 'var(--text-primary)' }}
            >
              <span aria-hidden style={{ width: 16, textAlign: 'center', lineHeight: '20px' }}>
                {a.icon}
              </span>
              <span className="min-w-0">
                <span className="md-body-md block">{a.label}</span>
                {a.hint && (
                  <span className="md-body-sm block" style={{ color: 'var(--text-muted)' }}>
                    {a.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Back arrow - navigation to ZEC-OS, split out from the title menu. */
export function StandaloneBackButton() {
  return (
    <a
      href="/"
      className="md-state flex shrink-0 items-center justify-center"
      style={{
        width: 40, height: 40,
        borderRadius: 'var(--md-shape-full)',
        color: 'var(--text-muted)',
      }}
      title="Open in ZEC-OS"
      aria-label="Open in ZEC-OS"
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
    </a>
  );
}
