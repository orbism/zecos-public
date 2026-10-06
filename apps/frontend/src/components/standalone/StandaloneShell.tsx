'use client';

import { BetaTag } from '@/components/beta/Beta';
import { isBetaApp } from '@/store/betaStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useDismiss } from './useDismiss';
import { WindowErrorBoundary } from '@/components/Window/WindowErrorBoundary';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUrlParamBridge } from './useUrlParamBridge';
import {
  useStandaloneTheme,
  useFontStep,
  FONT_STEPS,
  FONT_STEP_LABELS,
  type StandaloneMode,
} from './standaloneTheme';
import { StandaloneAuthChip } from './StandaloneAuthChip';
import { StandaloneBackButton, StandaloneTitleMenu, type TitleMenuAction } from './StandaloneTitleMenu';
import { StandaloneFooter, FOOTER_PX } from './StandaloneFooter';
import { StandalonePresence } from './StandalonePresence';
import { StandaloneZecamp } from './StandaloneZecamp';
import type { AppConfig } from '@/config/appRegistry';
import { copyText } from '@/utils/clipboard';
import { TitleBarSlot } from '@/components/Window/titleBarSlot';

// Fixed-grid apps that can't reflow - rendered at design width and zoomed to fit.
// Mirrors SCALE_APPS in Window.tsx.
const SCALE_APPS = new Set(['bbs-rpg']);

export const HEADER_PX = 60;
/** The Pools exception: room for its larger chrome controls. */
const POOLS_HEADER_PX = 88;

/**
 * Floor for the app area. Below this the charts and tiled panes get squeezed
 * into something unusable, so the page scrolls instead of the app shrinking.
 */
export const CONTENT_MIN_PX = 750;

/**
 * Apps that fit the screen on a phone instead of taking the floor above. Both
 * keep their own scroll inside and their action bar at the bottom, and a Buy
 * button pushed half below the fold by a floor meant for charts is worse than
 * a slightly shorter canvas.
 */
const FIT_ON_PHONE = new Set(['pools', 'market']);
/** Apps that size themselves to any height: never given the floor, on any screen. */
const FIT_ALWAYS = new Set(['zecamp', 'zoom']);
/** Games that fill the whole viewport instead of sitting at their window width. */
const FULL_BLEED = new Set(['zoom']);

/**
 * Text scale is published as a CSS variable on the standalone root; globals.css
 * remaps the (bounded) set of Tailwind text sizes against it.
 *
 * Deliberately NOT `zoom`: zooming the content wrapper required an inverse
 * width/height, which shrank every container while its contents grew and left
 * dead space inside the parents. Containers keep their natural size now.
 */
export function scaleVars(scale: number): React.CSSProperties {
  return { ['--ss-scale' as string]: String(scale) };
}

export function StandaloneShell({ config }: { config: AppConfig }) {
  const { mode, toggle } = useStandaloneTheme();
  const { step, scale, setStep } = useFontStep();
  const mobile = useIsMobile();
  const windowId = `standalone-${config.id}`;
  const paramsReady = useUrlParamBridge(config.id, windowId);

  // Bumping this remounts the app, dropping it back to a neutral state.
  const [resetKey, setResetKey] = useState(0);

  const AppComponent = config.component as React.ComponentType<{ windowId?: string }>;

  const scaleFit = mobile && SCALE_APPS.has(config.type);
  const designWidth = config.defaultSize.width || 600;
  const stageScale = scaleFit
    ? Math.min(1, ((typeof window !== 'undefined' ? window.innerWidth : designWidth) - 16) / designWidth)
    : 1;

  const actions = useStandaloneActions({
    onResetApp: () => setResetKey((k) => k + 1),
  });

  return (
    <div
      className="standalone-root flex h-dvh w-screen flex-col overflow-y-auto"
      style={{ background: 'var(--bg-desktop)', ...scaleVars(scale) }}
    >
      <StandaloneHeader
        title={config.title}
        icon={config.icon}
        logo={config.logo}
        mode={mode}
        onToggleTheme={toggle}
        fontStep={step}
        onFontStep={setStep}
        actions={actions}
        windowId={windowId}
        appId={config.id}
      />

      <main className="flex min-h-0 flex-1 flex-col px-1.5 pb-1 sm:px-4">
        <div
          className="flex w-full flex-1 flex-col overflow-hidden"
          style={{
            minHeight: FIT_ALWAYS.has(config.id) || (mobile && FIT_ON_PHONE.has(config.id)) ? 0 : CONTENT_MIN_PX,
            background: 'var(--bg-window)',
            borderRadius: 'var(--md-shape-lg)',
            boxShadow: 'var(--md-elev-1)',
          }}
        >
          <WindowErrorBoundary key={resetKey} title={config.title}>
            {!paramsReady ? null : scaleFit ? (
              <div
                style={{
                  zoom: stageScale,
                  width: designWidth,
                  height: `calc((100dvh - ${HEADER_PX + FOOTER_PX}px) / ${stageScale})`,
                }}
              >
                <AppComponent windowId={windowId} />
              </div>
            ) : config.category === 'games' ? (
              // Games need a DEFINITE height to resolve their `h-full` against.
              // `min-height` alone does not give one - a percentage height
              // against a min-height-only parent computes to auto, which is why
              // the stage kept collapsing to its content. So: stretch (no
              // items-center) plus an explicit 100% height with the floor
              // underneath it. Horizontal centring only, from justify-center.
              <div className="flex min-h-0 w-full flex-1 justify-center overflow-auto p-1.5 sm:p-4">
                <div
                  className="standalone-stage w-full"
                  style={FULL_BLEED.has(config.id) ? undefined : { maxWidth: config.defaultSize.width }}
                >
                  <AppComponent windowId={windowId} />
                </div>
              </div>
            ) : (
              <div className="min-h-0 w-full flex-1 overflow-auto p-1.5 sm:p-4">
                <AppComponent windowId={windowId} />
              </div>
            )}
          </WindowErrorBoundary>
        </div>
      </main>

      <StandaloneZecamp />
      <StandaloneFooter />
      <StandalonePresence />
    </div>
  );
}

/** Menu actions shared by both standalone hosts. */
export function useStandaloneActions({
  onResetApp,
  extra = [],
}: {
  onResetApp: () => void;
  extra?: TitleMenuAction[];
}): TitleMenuAction[] {
  const [copied, setCopied] = useState(false);

  const copyLink = useCallback(async () => {
    if (!(await copyText(window.location.href))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, []);

  return [
    {
      label: 'Reset app',
      hint: 'Back to a clean starting state',
      icon: '⟲',
      onSelect: onResetApp,
    },
    ...extra,
    {
      label: copied ? 'Link copied' : 'Copy link to this view',
      hint: 'Reopens exactly what you are looking at',
      icon: '🔗',
      onSelect: copyLink,
    },
    {
      label: 'Reload data',
      hint: 'Re-fetch everything from the node',
      icon: '↻',
      onSelect: () => window.location.reload(),
    },
  ];
}

export function StandaloneHeader({
  title, icon, logo, mode, onToggleTheme, fontStep, onFontStep, actions, windowId, appId,
}: {
  title: string;
  icon: string;
  logo?: string;
  mode: StandaloneMode;
  onToggleTheme: () => void;
  fontStep: number;
  onFontStep: (i: number) => void;
  actions: TitleMenuAction[];
  /** Lets the hosted app portal one item into the header. */
  windowId?: string;
  /** Which app this is, for Kaze's help videos. */
  appId?: string;
}) {
  // On a phone the slot controls live in Pools' own toolbar, so no taller header there.
  const mobile = useIsMobile();
  return (
    <header
      className="flex shrink-0 items-center gap-1 px-1.5 sm:gap-1.5 sm:px-4"
      // Pools alone gets a taller header: its title-bar controls (mode switch,
      // wtf?, tutorial, anchor countdown) are made larger and spaced out here.
      style={{ height: appId === 'pools' && !mobile ? POOLS_HEADER_PX : HEADER_PX }}
    >
      <StandaloneBackButton />
      <StandaloneTitleMenu title={title} icon={icon} logo={logo} appId={appId} actions={actions} />
      {isBetaApp(appId) && <BetaTag size="md" />}
      {/* Immediately right of the title, same as the desktop titlebar puts it
          right of the window name - so an app's chrome item is in the same
          place whichever host it is running under. */}
      {windowId && <TitleBarSlot windowId={windowId} style={{ marginLeft: appId === 'pools' ? 24 : 4 }} />}

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {/*
          * Phones get one menu button instead of share, theme and text size.
          * Laid out inline, those three plus the account chip were wider than
          * the screen, and the title - the one thing that says where you are -
          * was squeezed to nothing.
          */}
        <div className="hidden items-center gap-2 sm:flex">
          <ShareButton />
          <IconButton
            onClick={onToggleTheme}
            title={mode === 'dark' ? 'Switch to light' : 'Switch to dark'}
            label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {mode === 'dark' ? <SunIcon /> : <MoonIcon />}
          </IconButton>
          <FontSizeSelector step={fontStep} onChange={onFontStep} />
        </div>
        <div className="sm:hidden">
          <HeaderMenu mode={mode} onToggleTheme={onToggleTheme} fontStep={fontStep} onFontStep={onFontStep} />
        </div>

        <SoundToggle />
        <StandaloneAuthChip />
      </div>
    </header>
  );
}

/** The phone header's ☰: share, theme and text size, which do not fit inline there. */
function HeaderMenu({
  mode, onToggleTheme, fontStep, onFontStep,
}: {
  mode: StandaloneMode;
  onToggleTheme: () => void;
  fontStep: number;
  onFontStep: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, setOpen);

  const row = 'md-state md-body-md flex w-full items-center gap-2.5 px-3 py-2.5 text-left';
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More options"
        title="More options"
        className="md-state flex items-center justify-center"
        style={{
          width: 40, height: 40, borderRadius: 'var(--md-shape-full)',
          color: open ? 'var(--accent-gold)' : 'var(--text-muted)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-16px)] overflow-hidden p-1.5"
          style={{
            borderRadius: 'var(--md-shape-md)',
            background: 'var(--bg-window)',
            border: '1px solid var(--border-window)',
            boxShadow: 'var(--md-elev-3)',
          }}
        >
          <button
            role="menuitem"
            className={row}
            style={{ borderRadius: 'var(--md-shape-sm)', color: copied ? 'var(--accent-gold)' : 'var(--text-primary)' }}
            onClick={async () => {
              if (!(await copyText(window.location.href))) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            <span aria-hidden style={{ width: 18, textAlign: 'center' }}>{copied ? '✓' : '🔗'}</span>
            {copied ? 'Link copied' : 'Copy link to this view'}
          </button>
          <button
            role="menuitem"
            className={row}
            style={{ borderRadius: 'var(--md-shape-sm)', color: 'var(--text-primary)' }}
            onClick={onToggleTheme}
          >
            <span aria-hidden className="flex justify-center" style={{ width: 18 }}>
              {mode === 'dark' ? <SunIcon /> : <MoonIcon />}
            </span>
            {mode === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          {/* Stacked: phone tap targets make the four sizes too wide to share a line. */}
          <div className="px-3 pt-1 pb-2">
            <div className="md-body-md mb-1.5" style={{ color: 'var(--text-primary)' }}>Text size</div>
            <FontSizeSelector step={fontStep} onChange={onFontStep} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Copies the current URL. Apps that encode their view in query params (Explorer's
 * panes, Hindsight's scenario) therefore share the exact thing on screen, not
 * just the page.
 */
function ShareButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        if (!(await copyText(window.location.href))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="md-state flex items-center gap-1.5 px-3"
      style={{
        height: 40,
        borderRadius: 'var(--md-shape-full)',
        color: copied ? 'var(--accent-gold)' : 'var(--text-muted)',
        boxShadow: copied ? 'inset 0 0 0 2px var(--accent-gold)' : undefined,
      }}
      title="Copy a link to exactly this view"
      aria-label="Copy a link to exactly this view"
    >
      {copied ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      )}
      <span className="md-label-md hidden sm:inline">{copied ? 'copied' : 'share'}</span>
    </button>
  );
}

export function IconButton({
  onClick, title, label, children,
}: {
  onClick: () => void;
  title: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="md-state flex items-center justify-center"
      style={{
        width: 40, height: 40,
        borderRadius: 'var(--md-shape-full)',
        color: 'var(--text-muted)',
      }}
      title={title}
      aria-label={label}
    >
      {children}
    </button>
  );
}

/**
 * Sound on or off, and nothing else. The desktop taskbar has the slider; a
 * standalone page gets the one decision that matters there. Shares the same
 * settings, so it mutes every sound the desktop's switch does. Turning it on
 * with the volume left at zero would change nothing audible, so that also
 * brings the volume back to its default.
 */
function SoundToggle() {
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const volume = useSettingsStore((s) => s.volume);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // The persisted store hydrates after first paint; the prerendered header must not guess.
  if (!hydrated) return <div style={{ width: 40, height: 40 }} aria-hidden />;
  const on = soundEnabled && volume > 0;
  return (
    <IconButton
      onClick={() => {
        const s = useSettingsStore.getState();
        if (on) { s.setSoundEnabled(false); return; }
        s.setSoundEnabled(true);
        if (s.volume <= 0) s.setVolume(0.8);
      }}
      title={on ? 'Sound on - click to mute' : 'Sound off - click to unmute'}
      label={on ? 'Mute sound' : 'Unmute sound'}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
        {on
          ? <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" />
          : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
      </svg>
    </IconButton>
  );
}

/** Segmented S / M / L / XL control driving the content zoom. */
function FontSizeSelector({ step, onChange }: { step: number; onChange: (i: number) => void }) {
  return (
    <div
      role="group"
      aria-label="Text size"
      className="flex items-center gap-0.5 p-1"
      style={{ borderRadius: 'var(--md-shape-full)', background: 'var(--bg-window)' }}
    >
      {FONT_STEPS.map((_, i) => {
        const active = i === step;
        return (
          <button
            key={i}
            onClick={() => onChange(i)}
            aria-pressed={active}
            title={`Text size ${FONT_STEP_LABELS[i]}`}
            className="md-state flex items-center justify-center"
            style={{
              width: 30, height: 30,
              borderRadius: 'var(--md-shape-full)',
              background: active ? 'var(--accent-gold)' : 'transparent',
              color: active ? 'var(--bg-desktop)' : 'var(--text-muted)',
              fontSize: 10 + i,
              fontWeight: active ? 700 : 500,
              lineHeight: 1,
            }}
          >
            {FONT_STEP_LABELS[i]}
          </button>
        );
      })}
    </div>
  );
}

// Drawn rather than typed: the ☀ glyph has no coverage in the UI font stack and
// falls back to a tofu box.
function SunIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.22 4.22l1.56 1.56M18.22 18.22l1.56 1.56M2.5 12h2.2M19.3 12h2.2M4.22 19.78l1.56-1.56M18.22 5.78l1.56-1.56" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 106.5 15.7 8.5 8.5 0 004-5.2z" />
    </svg>
  );
}
