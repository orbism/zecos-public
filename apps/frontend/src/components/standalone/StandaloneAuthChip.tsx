'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useDismiss } from './useDismiss';

/**
 * Identity chip for standalone routes.
 *
 * Standalone pages are meant to be readable at a glance - no sign-in wall - so
 * a visitor with no identity is dropped into an implicit guest session here.
 * That session is flagged `standaloneGuest`, which SplashGate refuses, so
 * following a link into ZEC-OS proper still meets the login screen.
 */
export function StandaloneAuthChip() {
  const displayName = useAuthStore((s) => s.displayName);
  const isGuest = useAuthStore((s) => s.isGuest);
  const isVerified = useAuthStore((s) => s.isVerified);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);

  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(wrapRef, open, setOpen);

  // Grant the implicit guest session once, on the client only (the persisted
  // auth store hydrates after first paint).
  useEffect(() => {
    setHydrated(true);
    if (!useAuthStore.getState().isAuthenticated) {
      useAuthStore.getState().setStandaloneGuest();
    }
  }, []);

  // Render nothing until hydrated so the prerendered HTML doesn't claim an
  // identity the visitor may not have. Same footprint as the chip it becomes.
  if (!hydrated) return <div className="h-10 w-10 sm:w-[108px]" aria-hidden />;

  const verified = isVerified && !isGuest;
  const name = verified ? (displayName ?? 'Account') : 'Guest';
  const initial = name.charAt(0).toUpperCase();

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        // Phones: just the avatar - the name is in the tray it opens.
        className="md-state md-body-md flex items-center gap-2 py-1.5 pr-1.5 pl-1.5 sm:pr-3"
        style={{
          borderRadius: 'var(--md-shape-full)',
          border: '1px solid var(--border-light)',
          color: verified ? 'var(--accent-gold)' : 'var(--text-muted)',
        }}
        title={verified ? `Signed in as ${name}` : 'Browsing as guest'}
      >
        <span
          className="flex items-center justify-center"
          style={{
            width: 26, height: 26,
            borderRadius: 'var(--md-shape-full)',
            background: verified ? 'var(--accent-gold)' : 'var(--border-light)',
            color: 'var(--bg-window)',
            fontSize: 13, fontWeight: 700, lineHeight: 1,
          }}
          aria-hidden
        >
          {initial}
        </span>
        <span className="hidden max-w-[10ch] truncate sm:inline">{name}</span>
        <span
          aria-hidden
          className="hidden sm:inline"
          style={{
            fontSize: 9,
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
          className="absolute right-0 z-50 mt-2 w-68 overflow-hidden p-1.5"
          style={{
            borderRadius: 'var(--md-shape-md)',
            background: 'var(--bg-window)',
            border: '1px solid var(--border-window)',
            boxShadow: 'var(--md-elev-3)',
            animation: 'mdTrayIn var(--md-dur-medium) var(--md-ease-emphasized)',
          }}
        >
          <style>{`
            @keyframes mdTrayIn {
              from { opacity: 0; transform: translateY(-6px) scale(0.98); }
              to   { opacity: 1; transform: translateY(0)    scale(1); }
            }
          `}</style>

          <div className="px-3 pt-2 pb-2.5">
            <div className="md-title-sm" style={{ color: 'var(--text-primary)' }}>{name}</div>
            <div className="md-body-sm" style={{ color: 'var(--text-muted)' }}>
              {verified
                ? 'Verified account'
                : isAuthenticated
                  ? 'Browsing anonymously'
                  : 'Not signed in'}
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border-window)' }} />

          {verified ? (
            <>
              <TrayLink href="/" label="Open my profile in ZEC-OS" icon="👤" />
              <TrayButton
                label="Sign out"
                icon="⏻"
                danger
                onClick={() => {
                  logout();
                  setOpen(false);
                }}
              />
            </>
          ) : (
            <>
              {/* ?login asks for the login screen. A plain / would let a guest
                  session carried over from the desktop walk straight back in. */}
              <TrayLink href="/?login=1" label="Log in at ZEC-OS" icon="→" accent />
              <div
                className="md-body-sm px-3 pt-1 pb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Standalone pages are open to everyone. Signing in happens back at
                the desktop.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TrayLink({
  href, label, icon, accent,
}: { href: string; label: string; icon: string; accent?: boolean }) {
  return (
    <a
      href={href}
      role="menuitem"
      className="md-state md-body-md flex items-center gap-2.5 px-3 py-2"
      style={{
        borderRadius: 'var(--md-shape-sm)',
        color: accent ? 'var(--accent-blue)' : 'var(--text-primary)',
      }}
    >
      <span aria-hidden style={{ width: 16, textAlign: 'center' }}>{icon}</span>
      {label}
    </a>
  );
}

function TrayButton({
  label, icon, onClick, danger,
}: { label: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="md-state md-body-md flex w-full items-center gap-2.5 px-3 py-2 text-left"
      style={{
        borderRadius: 'var(--md-shape-sm)',
        color: danger ? 'var(--accent-orange)' : 'var(--text-primary)',
      }}
    >
      <span aria-hidden style={{ width: 16, textAlign: 'center' }}>{icon}</span>
      {label}
    </button>
  );
}
