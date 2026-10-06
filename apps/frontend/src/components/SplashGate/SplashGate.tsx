'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useHealth, maintenanceNote } from '@/hooks/useHealth';
import UaDecoder from '@/components/apps/tools/UaDecoder';
import { ZecQr } from '@/components/ui/ZecQr';
import { randomScene } from '@/lib/generative/scenes';
import XIcon from '@/components/ui/XIcon';
import { UserBadges } from '@/components/ui/UserBadges';

const BOOT_DURATION_MS = 3000;
const STORAGE_KEY = 'zec-os-last-boot';
const VERSION = process.env.NEXT_PUBLIC_VERSION ?? '1.1.2';

const ZEC_ADDR_RE = /^(t1|t3|u1|zs1)[a-zA-Z0-9]{30,}/;
function isValidAddr(a: string) { return ZEC_ADDR_RE.test(a.trim()); }

/*
 * Soft gold, copper and patina.
 *
 * The keys keep their CGA names because they are referenced in a hundred places
 * and renaming them would be a mechanical edit with no benefit - but nothing
 * here is CGA any more. `dkblue` and `cyan` in particular were a hard #0000AA
 * and #55FFFF, which is the pair that made this screen look like a BIOS error;
 * they are now the blue-green a copper roof turns after a few decades.
 *
 * Nothing is pure black. Backgrounds are warm and dark rather than absent, so
 * the gold has something to sit on instead of a hole.
 */
const C = {
  black:  '#101817',
  dkgray: '#7d9089',   // cool muted, was a warm grey
  gray:   '#c3d3cc',   // pale verdigris
  white:  '#f2f7f4',
  yellow: '#e3bb6a',   // gold, the primary accent
  cyan:   '#79bfb4',   // verdigris, light
  green:  '#7fc4a3',   // verdigris, green side
  red:    '#d98b6e',   // terracotta
  dkblue: '#2f4a46',   // deep patina
  dkcyan: '#b87333',   // true copper
  // Maintenance: warm and unmistakable against the patina, without borrowing
  // the red that means "you did something wrong".
  orange: '#e0a05a',
};

/*
 * Surfaces: patina, not brown.
 *
 * The first pass built everything from warm browns and the whole screen read as
 * leather. These are oxidised-copper greens with the copper itself kept for
 * edges and accents, which is where it belongs - the metal shows at the seams,
 * the patina covers the faces.
 *
 * The page and the card are deliberately DIFFERENT grounds. Sharing one made
 * the card an outline drawn on a flat field rather than an object sitting on
 * something.
 */
const SURFACE = {
  page:   '#0e1615',   // deep, behind everything
  panel:  '#182422',   // the card - lighter and greener than the page
  raised: '#1f2d2a',   // header, inputs
  line:   '#334a45',   // hairlines
  edge:   '#8a6d3a',   // the card's gold rim
};

type Phase = 'check' | 'auth' | 'welcome-back' | 'verify' | 'set-password' | 'booting' | 'done';
type PollStatus = 'waiting' | 'code_sent' | 'confirmed' | 'expired' | 'rejected';

interface Challenge {
  nonce: string;
  valueZEC: string;
  zip321: string;
  toAddress: string;
  expiresAt: number;
  kind: 'taddr' | 'shielded';
  memoText?: string;
  status?: string;   // present when the backend resumes an already-paid challenge
  resumed?: boolean;
}

// Persist the active challenge so a closed/reloaded tab can RESUME polling by
// nonce (the backend reconciler may have already sent the code) instead of
// losing the payment. Bounded to the honor window so ancient ones don't linger.
const CHALLENGE_KEY = 'zec-os-challenge';
function saveChallenge(c: Challenge, addr: string, name: string, reset = false) {
  try { localStorage.setItem(CHALLENGE_KEY, JSON.stringify({ c, addr, name, reset, savedAt: Date.now() })); } catch { /* ignore */ }
}
function loadChallenge(): { c: Challenge; addr: string; name: string; reset: boolean } | null {
  try {
    const raw = localStorage.getItem(CHALLENGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v?.c?.nonce || Date.now() - (v.savedAt ?? 0) > 31 * 24 * 3600 * 1000) { localStorage.removeItem(CHALLENGE_KEY); return null; }
    return { c: v.c, addr: v.addr ?? '', name: v.name ?? '', reset: v.reset === true };
  } catch { return null; }
}
function clearChallenge() { try { localStorage.removeItem(CHALLENGE_KEY); } catch { /* ignore */ } }

/**
 * What is happening to the payment, while it happens.
 *
 * Three states, in the order they occur: nothing seen yet, seen but not yet in
 * a block, and confirmed. "Checked Ns ago" is there because the honest answer
 * to "is this thing working" is when it last looked - a spinner on a screen
 * that polls every fifteen seconds says nothing at all.
 */
function ProgressLine({ payment, lastPoll }: {
  payment: { seen: boolean; txid: string | null; confirmations: number; confirmationsNeeded: number } | null;
  lastPoll: number;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ago = lastPoll ? Math.max(0, Math.round((Date.now() - lastPoll) / 1000)) : null;
  const done = payment && payment.confirmations >= payment.confirmationsNeeded;
  const colour = done ? C.green : payment?.seen ? C.yellow : C.gray;
  const head = !payment?.seen
    ? 'Watching for your payment'
    : done
      ? 'Payment confirmed - sending your code'
      : `Payment seen - waiting for it to be mined (${payment.confirmations} of ${payment.confirmationsNeeded} confirmation${payment.confirmationsNeeded === 1 ? '' : 's'})`;
  return (
    <div style={{ border: `1px solid ${colour}44`, background: `${colour}0f`, padding: '8px 10px', marginBottom: 12, fontSize: '13px' }}>
      <div style={{ color: colour, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ animation: payment?.seen && !done ? 'pulse 1.4s ease-in-out infinite' : undefined }}>
          {done ? '✓' : payment?.seen ? '◐' : '○'}
        </span>
        {head}
      </div>
      {payment?.txid && (
        <div style={{ color: C.dkgray, fontSize: '11.5px', marginTop: 4, wordBreak: 'break-all' }}>
          tx {payment.txid.slice(0, 10)}…{payment.txid.slice(-10)}
        </div>
      )}
      <div style={{ color: C.dkgray, fontSize: '11.5px', marginTop: 4 }}>
        {ago === null ? 'checking…' : ago < 2 ? 'checked just now' : `checked ${ago}s ago`} · rechecks every 15s
      </div>
    </div>
  );
}

export function SplashGate({ children }: { children: React.ReactNode }) {
  const auth = useAuthStore();
  const [phase, setPhase]       = useState<Phase>('check');
  const [address, setAddress]   = useState('');
  const [dispName, setDispName] = useState('');
  /*
   * Came here from "Forgot password?", not from the front door.
   *
   * The screens after verification are written for somebody arriving for the
   * first time - "ownership verified", "set a password so you can sign in from
   * any device" - which is the wrong thing to say to a person who already has
   * an account and came to get back INTO it. It rides in localStorage beside
   * the challenge because the poll survives a reload, and the journey has to
   * survive with it.
   */
  const [resetting, setResetting] = useState(false);
  const [addrErr, setAddrErr]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState(0);
  /** Greeting on the boot screen: 'back' after a sign-in, 'new' after a first verification. */
  const [welcome, setWelcome] = useState<{ kind: 'back' | 'new'; badges: string[] } | null>(null);

  const [showDecoder, setShowDecoder] = useState(false);
  const [challenge, setChallenge]   = useState<Challenge | null>(null);
  const health = useHealth();
  /*
   * Verification needs the backend AND a wallet that can see payments arrive.
   * Signing in with a password needs neither of those to be healthy beyond the
   * backend itself, and browsing as a guest needs nothing at all - so an outage
   * takes away exactly one door, and says so, rather than locking the building.
   */
  const verifyDown = health.auth !== 'up' || health.wallet !== 'up';
  /** The sysop's registration switch: closed shows a notice, and says until when if they set it. */
  const [reg, setReg] = useState<{ open: boolean; reopensAt: string | null; message?: string | null }>({ open: true, reopensAt: null });
  useEffect(() => {
    // Re-read now and then, so a splash left open notices the sysop reopening.
    const load = () => fetch('/api/registration', { cache: 'no-store' }).then(r => r.json()).then(setReg).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);
  // A calendar day, not a moment: read in UTC, where the sysop's switch stores it.
  const regUntil = reg.reopensAt
    ? new Date(reg.reopensAt).toLocaleDateString(undefined, { dateStyle: 'long', timeZone: 'UTC' })
    : null;
  const [pollStatus, setPollStatus] = useState<PollStatus>('waiting');
  /**
   * What the backend can see of the payment: sighted in the mempool, then
   * confirmations. The modal used to show nothing at all between "send this"
   * and the code arriving, which is a minute or more of a screen that looks
   * like it has stopped working.
   */
  const [payment, setPayment] = useState<{ seen: boolean; txid: string | null; confirmations: number; confirmationsNeeded: number } | null>(null);
  /** Mined deep enough for the code to be on its way. */
  const paymentDone = Boolean(payment && payment.confirmations >= payment.confirmationsNeeded);
  const [lastPoll, setLastPoll] = useState<number>(0);
  const [pollErr, setPollErr]       = useState('');
  const [codeInput, setCodeInput]   = useState('');
  const [codeErr, setCodeErr]       = useState('');
  const [walletMsg, setWalletMsg]   = useState('');
  const [loginPw, setLoginPw]       = useState('');
  const [newPw, setNewPw]           = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [pwErr, setPwErr]           = useState('');
  const [showZodlInfo, setShowZodlInfo] = useState(false);
  const [showBigQr, setShowBigQr] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [, setTick] = useState(0); // re-render for the expiry countdown
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /*
   * One scene for the life of this mount.
   *
   * Declared HERE, with the other hooks, and not beside the render.
   * `phase === 'check'` and `phase === 'done'` both return early further down,
   * so a hook placed after them exists on some renders and not others - which
   * is exactly the "rendered more hooks than during the previous render" this
   * component threw. Every hook in this file has to sit above those two lines.
   */
  const sceneRef = useRef(randomScene());
  const scene = sceneRef.current;


  const startBoot = useCallback((greet?: 'back' | 'new') => {
    setProgress(0);
    setPhase('booting');
    const token = useAuthStore.getState().sessionToken;
    if (!greet || !token) return;
    setWelcome({ kind: greet, badges: [] });
    fetch('/api/user/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p?.badges?.length) setWelcome({ kind: greet, badges: p.badges }); })
      .catch(() => {});
  }, []);

  const finishBoot = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    setPhase('done');
  }, []);

  // Determine initial phase after hydration.
  // Key rule: a RELOAD must REUSE the persisted session, never mint a new one.
  // Minting a new session on reload would revoke the user's own prior (still
  // live) session and falsely report "signed you out elsewhere". So for verified
  // users we validate the existing token server-side and only force a re-login
  // if it's genuinely dead (expired past the 24h timeout, or revoked).
  useEffect(() => {
    let cancelled = false;
    const decide = async () => {
      // Read FRESH state (not the first-render closure) so we're never fooled by
      // a persist-hydration race that would look "unauthenticated" and force login.
      const a = useAuthStore.getState();
      /*
       * "Log in at ZEC-OS" from a standalone page arrives as /?login=1. That is
       * a request for the login screen, so a guest - implicit or one carried
       * over from an earlier desktop visit - is signed out here rather than
       * resumed. A verified session is left alone: there is nothing to log in
       * to. The param is removed so a reload does not repeat it.
       */
      const wantsLogin = new URLSearchParams(window.location.search).has('login');
      if (wantsLogin) {
        const url = new URL(window.location.href);
        url.searchParams.delete('login');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
      // A guest identity granted implicitly by a standalone /<app> route does
      // NOT get someone into ZEC-OS proper - they still meet the splash here.
      if (a.standaloneGuest || (wantsLogin && a.isGuest)) {
        useAuthStore.setState({
          isGuest: false, isAuthenticated: false, displayName: null, standaloneGuest: false,
        });
        if (!cancelled) setPhase('auth');
        return;
      }
      if (!a.isAuthenticated) {
        // Resume an in-flight verification the tab dropped (payment may have
        // since been serviced by the backend reconciler).
        const saved = loadChallenge();
        if (saved && !cancelled) {
          setAddress(saved.addr); setDispName(saved.name); setResetting(saved.reset);
          setChallenge(saved.c); setPollStatus('waiting'); setPhase('verify');
          return;
        }
        if (!cancelled) setPhase('auth');
        return;
      }
      // Purge legacy "local profile" identities - verified or guest only.
      if (!a.isVerified && !a.isGuest) { a.logout(); if (!cancelled) setPhase('auth'); return; }
      // Guests have no server session - nothing to validate.
      if (a.isGuest || !a.sessionToken) { if (!cancelled) setPhase('done'); return; }
      // Verified: reuse the token if the server still considers it valid.
      try {
        const res = await fetch('/api/auth/session', { headers: { Authorization: `Bearer ${a.sessionToken}` } });
        const data = await res.json().catch(() => ({ valid: false }));
        if (cancelled) return;
        if (data?.valid) {
          setPhase('done');            // reuse existing session - no new login, no revoke
        } else {
          a.logout();                  // expired/revoked → clean re-login (old session already dead, so no false notice)
          setPhase('auth');
        }
      } catch {
        if (!cancelled) setPhase('done'); // backend unreachable - trust the local session rather than forcing a login
      }
    };
    // Wait for the persisted store to finish rehydrating before deciding.
    const p = (useAuthStore as unknown as {
      persist?: { hasHydrated?: () => boolean; onFinishHydration?: (cb: () => void) => (() => void) };
    }).persist;
    if (!p || typeof p.hasHydrated !== 'function' || p.hasHydrated() || typeof p.onFinishHydration !== 'function') {
      decide();
      return () => { cancelled = true; };
    }
    const unsub = p.onFinishHydration(() => decide());
    return () => { cancelled = true; unsub?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Boot progress animation
  useEffect(() => {
    if (phase !== 'booting') return;
    const interval = setInterval(() => {
      setProgress(p => Math.min(p + Math.random() * 15, 95));
    }, 200);
    const timeout = setTimeout(() => {
      setProgress(100);
      setTimeout(finishBoot, 300);
    }, BOOT_DURATION_MS);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') finishBoot(); };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(interval); clearTimeout(timeout); window.removeEventListener('keydown', onKey); };
  }, [phase, finishBoot]);

  // Live display-name availability - debounced as the user types
  useEffect(() => {
    const name = dispName.trim();
    if (!name) { setNameStatus('idle'); return; }
    setNameStatus('checking');
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/name-check?name=${encodeURIComponent(name)}&address=${encodeURIComponent(address.trim())}`);
        const data = await res.json();
        setNameStatus(data.available ? 'available' : 'taken');
      } catch { setNameStatus('idle'); }
    }, 400);
    return () => clearTimeout(t);
  }, [dispName, address]);

  // Keep the "expires in N min" countdown current while waiting on payment
  useEffect(() => {
    if (phase !== 'verify' || pollStatus !== 'waiting') return;
    const t = setInterval(() => setTick(n => n + 1), 15_000);
    return () => clearInterval(t);
  }, [phase, pollStatus]);

  // Poll verification status (t-addr payment / shielded funding)
  useEffect(() => {
    if (phase !== 'verify' || !challenge) return;
    if (pollStatus === 'confirmed' || pollStatus === 'expired' || pollStatus === 'rejected') return;

    const look = async () => {
      // Note: we do NOT hard-stop on the client clock past expiresAt anymore - the
      // backend scans for a late payment and signals `status: 'expired'` only when
      // there's genuinely nothing, so a payment landing just past the QR window
      // still completes here (and the reconciler catches the rest).
      try {
        const res  = await fetch(`/api/auth/verify/${challenge.nonce}`);
        const data = await res.json();
        setLastPoll(Date.now());
        if (data.payment) setPayment(data.payment);
        if (res.status === 404) {
          clearInterval(pollRef.current!); clearChallenge(); setPollStatus('expired'); return;
        }
        if (res.status === 409) {
          // t-addr: payment arrived but from the wrong address
          clearInterval(pollRef.current!);
          setPollErr(data.error ?? 'Payment came from a different address.');
          setPollStatus('rejected');
          return;
        }
        if (data.verified) {
          clearInterval(pollRef.current!); clearChallenge();
          setPollStatus('confirmed');
          try { if (data.signedOutOthers) sessionStorage.setItem('zec-signedout-others', String(data.signedOutOthers)); } catch { /* ignore */ }
          auth.setAuth({ walletAddress: data.address || address.trim(), displayName: data.displayName ?? (dispName.trim() || null), sessionToken: data.sessionId, isVerified: true });
          setTimeout(() => setPhase('set-password'), 1200);
        } else if (data.status === 'code_sent') {
          setPollStatus('code_sent');
        } else if (data.status === 'expired') {
          clearInterval(pollRef.current!); setPollStatus('expired');
        }
      } catch { /* retry on next tick */ }
    };
    void look();
    pollRef.current = setInterval(() => void look(), 15_000);
    return () => clearInterval(pollRef.current!);
  }, [phase, challenge, pollStatus, address, dispName, auth, startBoot]);

  if (phase === 'check') return null;
  if (phase === 'done')  return <>{children}</>;

  // Password login: verified accounts sign in with display name (or address) +
  // password - no need to retype the wallet address.
  const handleLogin = async () => {
    const addr = address.trim();
    const name = dispName.trim();
    if (!addr && !name) { setAddrErr('Enter your display name (or address) to sign in'); return; }
    if (addr && !isValidAddr(addr)) { setAddrErr('Enter a valid Zcash address (or leave it blank and use your display name)'); return; }
    if (!loginPw) { setAddrErr('Enter your password (or verify ownership if you have no account yet)'); return; }
    setAddrErr(''); setLoading(true);
    try {
      const res  = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr || undefined, name: name || undefined, password: loginPw }) });
      const data = await res.json();
      if (res.ok && data.verified) {
        try { if (data.signedOutOthers) sessionStorage.setItem('zec-signedout-others', String(data.signedOutOthers)); } catch {}
        auth.setAuth({ walletAddress: data.address, displayName: data.displayName ?? (dispName.trim() || null), sessionToken: data.sessionId, isVerified: true });
        startBoot('back');
      } else {
        setAddrErr(data.error ?? 'Login failed');
      }
    } catch { setAddrErr('Backend unreachable'); }
    finally { setLoading(false); }
  };

  // Post-verification: offer a password so future logins skip the dust dance.
  const handleSetPassword = async (skip: boolean) => {
    if (skip) { startBoot(resetting ? 'back' : 'new'); return; }
    if (newPw.length < 8) { setPwErr('Password must be at least 8 characters'); return; }
    if (newPw !== newPwConfirm) { setPwErr('Passwords do not match'); return; }
    setPwErr(''); setLoading(true);
    try {
      const res  = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.sessionToken}` },
        body: JSON.stringify({ newPassword: newPw }),
      });
      const data = await res.json();
      if (res.ok) startBoot(resetting ? 'back' : 'new');
      else setPwErr(data.error ?? 'Failed to set password');
    } catch { setPwErr('Backend unreachable'); }
    finally { setLoading(false); }
  };

  const handleStartChallenge = async (opts: { reset?: boolean } = {}) => {
    const isReset = opts.reset === true;
    setResetting(isReset);
    if (!isValidAddr(address)) { setAddrErr('Enter a valid Zcash address first'); return; }
    if (nameStatus === 'taken') { setAddrErr('That display name is taken - pick another before verifying'); return; }
    setAddrErr(''); setLoading(true);
    try {
      const res  = await fetch('/api/auth/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: address.trim(), displayName: dispName.trim() || null }) });
      const data = await res.json();
      if (res.ok) {
        setChallenge(data); setPhase('verify');
        // A resumed (already-paid) challenge comes back as code_sent → go straight to code entry.
        setPollStatus(data.status === 'code_sent' ? 'code_sent' : 'waiting');
        setPollErr(''); setCodeInput(''); setCodeErr(''); setWalletMsg('');
        saveChallenge(data, address.trim(), dispName.trim(), isReset);
      }
      else if (data.code === 'registrations_closed') { setReg({ open: false, reopensAt: data.reopensAt ?? null, message: data.message ?? null }); setAddrErr(''); }
      else setAddrErr(data.error ?? 'Failed to create challenge');
    } catch { setAddrErr('Backend unreachable'); }
    finally { setLoading(false); }
  };

  const handleSubmitCode = async () => {
    if (!challenge || codeInput.trim().length !== 6) { setCodeErr('Enter the 6-digit code from the memo'); return; }
    setCodeErr(''); setLoading(true);
    try {
      const res  = await fetch('/api/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: challenge.nonce, code: codeInput.trim() }) });
      const data = await res.json();
      if (res.ok && data.verified) {
        clearInterval(pollRef.current!); clearChallenge();
        setPollStatus('confirmed');
        auth.setAuth({ walletAddress: data.address || address.trim(), displayName: data.displayName ?? (dispName.trim() || null), sessionToken: data.sessionId, isVerified: true });
        setTimeout(() => setPhase('set-password'), 1200);
      } else {
        setCodeErr(data.error ?? 'Verification failed');
      }
    } catch { setCodeErr('Backend unreachable'); }
    finally { setLoading(false); }
  };

  // The browser exposes no API to detect a missing protocol handler - if the
  // launch succeeds the page loses focus, so no blur within the window means
  // no wallet is registered on this device.
  const tryOpenWallet = (uri: string) => {
    setWalletMsg('');
    let launched = false;
    const onBlur = () => { launched = true; };
    window.addEventListener('blur', onBlur);
    window.location.href = uri;
    setTimeout(() => {
      window.removeEventListener('blur', onBlur);
      if (!launched && !document.hidden) {
        setWalletMsg('No Zcash wallet is set up to handle payment links on this device. Scan the QR code with your phone wallet, or copy the fields manually.');
      }
    }, 1200);
  };

  const backToAuth = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    clearChallenge();
    setChallenge(null);
    setPhase('auth');
  };

  // ── Shared style helpers ────────────────────────────────────────────────────

  const input: React.CSSProperties = {
    background: SURFACE.raised, border: `1px solid ${C.dkcyan}`, color: C.white,
    fontFamily: 'monospace', fontSize: '14px', padding: '9px 11px', borderRadius: 8,
    width: '100%', outline: 'none', boxSizing: 'border-box',
    transition: 'border-color .2s ease-in-out, box-shadow .2s ease-in-out',
  };

  /*
   * One filled action, everything else quiet.
   *
   * Both buttons used to be outlined boxes of similar weight, so nothing on the
   * screen said which one you were meant to press.
   */
  /*
   * Three actions, three steps along one hue.
   *
   * Sign in is the brightest gold, verification a shade warmer, guest a light
   * beige - all bright, all in the same family, separated by how much light
   * each one carries rather than by hue. The earlier ramp reached down into
   * bronze and brown for its third step and those are not colours, they are
   * mud. Beige is where this family ends.
   */
  const BTN_TONE: Record<string, { bg: string; ink: string }> = {
    primary: { bg: '#f5cf72', ink: '#2b2208' },   // gold, brightest - sign in
    verify:  { bg: '#e8c169', ink: '#2b2208' },   // warm gold        - verify
    guest:   { bg: '#ddc79a', ink: '#33290f' },   // beige            - guest
  };

  const btn = (variant?: 'primary' | 'guest' | 'verify'): React.CSSProperties => {
    const tone = variant ? BTN_TONE[variant] : undefined;
    if (!tone) {
      return {
        background: 'transparent', border: `1px solid ${SURFACE.line}`, color: C.gray,
        fontFamily: 'monospace', fontSize: '14px', padding: '9px 18px',
        borderRadius: 8, cursor: 'pointer', transition: 'filter .2s ease-in-out, border-color .2s ease-in-out, background-color .2s ease-in-out',
      };
    }
    return {
      background: tone.bg, border: `1px solid ${tone.bg}`, color: tone.ink, fontWeight: 700,
      fontFamily: 'monospace', fontSize: '14px', padding: '9px 18px',
      borderRadius: 8, cursor: 'pointer', transition: 'filter .2s ease-in-out, background-color .2s ease-in-out',
    };
  };

  const lbl: React.CSSProperties = {
    color: C.yellow, fontSize: '11px', letterSpacing: '1.1px', textTransform: 'uppercase',
    marginBottom: 5, display: 'block',
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, fontFamily: 'monospace',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      /* A warm ground with light in the middle, rather than a black void with a
         box floating on it. */
      /*
       * Many close stops, not three far apart.
       *
       * A gradient with widely spaced stops quantises to visible steps on an
       * 8-bit display, and the eye reads those steps as straight seams cutting
       * the screen into panels. Spacing them tightly keeps every step below
       * one level, so it reads as continuous.
       */
      background:
        'radial-gradient(135% 105% at 50% 24%,'
        + ' #1a2a26 0%, #182724 12%, #16241f 24%, #14211d 36%,'
        + ' #121e1a 48%, #101a17 60%, #0e1715 72%, #0c1412 85%, #0a1110 100%)',
    }}>
      {/*
        * A living dithered field behind the card.
        *
        * The same engine the rest of the OS uses, run at ultra density and
        * turned right down - it should read as texture in the corner of the eye
        * and never as a thing competing with a password field. Slow contours
        * over a wide, shallow landscape, in verdigris.
        *
        * Pointer-events off and aria-hidden: it is decoration on a screen whose
        * only job is to let someone in.
        */}
      {/*
        * A different scene every time the splash loads.
        *
        * Chosen once, in a ref, rather than inline - a scene picked during
        * render would change on every re-render, and this component re-renders
        * on every keystroke in the address field.
        *
        * Near enough to full strength on purpose. Opacity does not dim a
        * colour, it mixes it with what is behind; the scenes are dimmed by
        * their own tones instead.
        */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, opacity: 0.9, pointerEvents: 'none' }}>
        {scene.render()}
      </div>

      <div style={{
        position: 'relative', zIndex: 1,
        width: 520, borderRadius: 14, overflow: 'hidden',
        background:
          'linear-gradient(172deg,'
          + ' #21302c 0%, #1f2d2a 14%, #1c2a27 28%, #1a2724 42%,'
          + ' #182422 56%, #17221f 70%, #15201d 85%, #131d1b 100%)',
        // A gold rim, not a grey one: it is the only hard line on the screen and
        // it is what separates the card from the field behind it.
        border: `1px solid ${SURFACE.edge}`,
        /* One soft shadow instead of a hard offset block and two stacked
           borders. The old frame was three outlines deep. */
        boxShadow: '0 28px 80px rgba(0,0,0,.62), 0 0 0 1px rgba(227,187,106,.10),'
          + ' 0 1px 0 rgba(255,255,255,.05) inset',
      }}>

        {/* ── Brand header - always visible ──────────────────────────────── */}
        <div style={{
          padding: '20px 24px 18px',
          background: 'transparent',
          borderBottom: `1px solid ${SURFACE.line}`,
          boxShadow: `0 1px 0 rgba(184,115,51,.14)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img
              src="/zec-logo.svg"
              alt="ZEC"
              style={{ width: 44, height: 44, imageRendering: 'pixelated', flexShrink: 0 }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: C.yellow, fontSize: '21px', fontFamily: 'var(--font-press-start, monospace)', letterSpacing: 1 }}>
                ZEC-OS
              </div>
              {/* Version, purpose and tagline were three separate lines under a
                  52px logo. One line says the same thing. */}
              <div style={{ color: C.dkgray, fontSize: '11.5px', marginTop: 5 }}>
                v{VERSION} · Explore. Analyze. Learn. Play.
              </div>
            </div>
            <a
              href="https://x.com/zecos_" target="_blank" rel="noopener noreferrer"
              title="ZEC-OS on X" aria-label="ZEC-OS on X"
              style={{
                marginLeft: 'auto', flexShrink: 0, width: 38, height: 38, borderRadius: 8,
                display: 'grid', placeItems: 'center', color: C.yellow,
                border: `1px solid ${SURFACE.line}`, transition: 'background-color .2s, border-color .2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(227,187,106,.12)'; e.currentTarget.style.borderColor = C.yellow; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = SURFACE.line; }}
            >
              <XIcon size={20} weight={1.4} />
            </a>
          </div>
        </div>

        {/* ── Content area ────────────────────────────────────────────────── */}
        <div style={{ padding: '22px 24px 24px' }}>

          {/* AUTH */}
          {phase === 'auth' && (
            <>
              {verifyDown && (
                <div style={{
                  border: `1px solid ${C.orange}66`, background: `${C.orange}12`, color: C.orange,
                  padding: '10px 12px', marginBottom: 14, fontSize: '13px', lineHeight: 1.6,
                }}>
                  {/*
                    * Deliberately no reason and no clock.
                    *
                    * Naming the cause meant explaining our plumbing to someone
                    * who came here to log in, and it made the copy change shape
                    * depending on which half was unwell. Naming a duration is
                    * worse: an estimate we cannot keep is how "a few minutes"
                    * becomes a complaint. The two facts that actually matter to
                    * the person reading it are both still here - what they CAN
                    * do, and that no money is involved. The real reason is in
                    * the beacon and the logs, where it is useful.
                    */}
                  <b>Maintenance</b> - the dev is elbow-deep in the plumbing, teaching the node to count again.
                  <div style={{ color: C.gray, marginTop: 4 }}>
                    You can sign in with your password, or continue as a guest. New account
                    verification is paused for the moment, so nothing can be charged. It comes back
                    on its own.
                  </div>
                </div>
              )}
              {!reg.open && (
                <div role="status" style={{
                  border: `2px solid ${C.orange}`, background: `${C.orange}1f`, color: C.orange,
                  padding: '14px 16px', marginBottom: 16, fontSize: '14px', lineHeight: 1.6, borderRadius: 6,
                }}>
                  <div style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 6 }}>
                    ⛔ Closed to new accounts
                  </div>
                  <div>
                    {reg.message || 'New user registration is disabled during a maintenance window.'}{' '}
                    {regUntil
                      ? <>Come back on <b style={{ color: C.yellow }}>{regUntil}</b>.</>
                      : <b style={{ color: C.yellow }}>Until further notice.</b>}
                  </div>
                  <div style={{ color: C.gray, marginTop: 6 }}>
                    Already have an account? Sign in with your display name and password below, or
                    reset it with &quot;Forgot password?&quot;. Anyone can still look around as a guest.
                  </div>
                </div>
              )}
              <div style={{ color: C.dkcyan, fontSize: '13px', marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${SURFACE.line}` }}>
                Connect your Zcash wallet to continue. Your address is your identity.
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>ZCASH ADDRESS</label>
                <div style={{ color: C.gray, fontSize: '12px', marginBottom: 4 }}>
                  We encourage using a shielded address (u1… / zs1…) to preserve your anonymity.
                </div>
                <input
                  style={input} type="text" placeholder="t1… or u1… or zs1…"
                  value={address}
                  onChange={e => { setAddress(e.target.value); setAddrErr(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleStartChallenge()}
                  spellCheck={false} autoComplete="off"
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>DISPLAY NAME</label>
                  <input
                    style={input} type="text" placeholder="anonymous"
                    value={dispName}
                    onChange={e => setDispName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleStartChallenge()}
                    spellCheck={false} autoComplete="off"
                  />
                  <div style={{ color: C.dkgray, fontSize: '10px', marginTop: 3 }}>(optional)</div>
                  {nameStatus !== 'idle' && !loginPw && (
                    <div style={{ fontSize: '12px', marginTop: 3, color: nameStatus === 'taken' ? C.red : nameStatus === 'available' ? C.green : C.dkgray }}>
                      {nameStatus === 'checking' ? 'checking…' : nameStatus === 'taken' ? '✗ name taken' : '✓ available'}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>PASSWORD</label>
                  <input
                    style={input} type="password" placeholder="········"
                    value={loginPw}
                    onChange={e => { setLoginPw(e.target.value); setAddrErr(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    autoComplete="current-password"
                  />
                  <div style={{ color: C.dkgray, fontSize: '10px', marginTop: 3 }}>(existing accounts)</div>
                </div>
              </div>

              {addrErr && <div style={{ color: C.red, fontSize: '13px', marginBottom: 10 }}>{addrErr}</div>}

              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button style={btn('primary')} disabled={loading} onClick={handleLogin}>
                  {loading ? 'Working…' : 'Sign in'}
                </button>
                <button
                  style={{ ...btn('verify'), ...(!reg.open ? { opacity: 0.45, cursor: 'not-allowed', filter: 'grayscale(1)' } : {}) }}
                  disabled={loading || verifyDown || !reg.open}
                  /* Wrapped: passing the handler bare hands React's click event
                     in as the options object. */
                  onClick={() => handleStartChallenge()}
                  title={!reg.open
                    ? `Closed to new accounts${regUntil ? ` until ${regUntil}` : ''} - existing accounts sign in, or use Forgot password?`
                    : verifyDown ? 'Paused while the node is worked on - sign in or continue as a guest' : undefined}
                >
                  {loading ? 'Working…' : !reg.open ? 'Registration closed' : verifyDown ? 'Verification paused' : 'Verify ownership'}
                </button>
                <button style={btn('guest')} disabled={loading} onClick={() => { auth.setGuest(); startBoot(); }}>
                  Guest login
                </button>
              </div>

              <button
                onClick={() => {
                  if (verifyDown) {
                    setAddrErr('Resetting a password means verifying ownership again, which is paused while the node is worked on. Try again in a few minutes.');
                    return;
                  }
                  if (!isValidAddr(address)) {
                    setAddrErr('Enter your Zcash address above first - resetting means re-verifying ownership');
                    return;
                  }
                  handleStartChallenge({ reset: true });
                }}
                disabled={loading}
                style={{ background: 'transparent', border: 'none', color: C.cyan, fontFamily: 'monospace', fontSize: '13px', padding: 0, cursor: 'pointer', textDecoration: 'underline', marginBottom: 14, display: 'block' }}
              >
                Forgot password?
              </button>

              {/* A quiet heads-up about the coming ZNS sign-in, not a feature yet. */}
              <a href="https://zcashnames.com" target="_blank" rel="noopener noreferrer" className="zns-soon"
                title="zcashnames.com: human-readable names for Zcash addresses"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 14, textDecoration: 'none', color: C.gray, fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.35 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/zcashnames.svg" alt="zcashnames" width={30} height={32} style={{ display: 'block', flex: 'none' }} />
                <span>Integration with zcashnames<br />coming soon</span>
              </a>
              <style>{'.zns-soon { opacity: .7; transition: opacity .15s; } .zns-soon:hover, .zns-soon:focus-visible { opacity: 1; }'}</style>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: helpOpen ? 6 : 12 }}>
                <button
                  onClick={() => setHelpOpen(o => !o)}
                  style={{ background: 'transparent', border: 'none', color: C.yellow, fontFamily: 'monospace', fontSize: '15px', padding: 0, cursor: 'pointer', display: 'block' }}
                >
                  {helpOpen ? '▾' : '▸'} How does this work?
                </button>
                {/* Kaze's login video, once a sysop switches it on for this screen */}
              </div>
              {helpOpen && (
                <div style={{ color: C.dkgray, fontSize: '12px', lineHeight: 1.7, marginBottom: 12 }}>
                  <div><span style={{ color: C.gray }}>Sign in</span> - display name + password for accounts that already verified ownership (no address needed).</div>
                  <div><span style={{ color: C.gray }}>Verify ownership</span> - first time here: prove control of your address to create your account.</div>
                  <div>Forgot your password? Run <span style={{ color: C.gray }}>Verify ownership</span> again with your address - you&apos;ll set a new one after.</div>
                  {/*
                    * The one thing people cannot work out for themselves.
                    *
                    * A wallet hands out a new address every time you ask it for
                    * one, and only the exact address you verified with signs you
                    * in - so "use my wallet" is not enough, and the failure looks
                    * like the account never existed. Said here, in the terms
                    * somebody actually experiences it.
                    */}
                  <div>
                    <span style={{ color: C.yellow }}>Save the exact address you verify with.</span>{' '}
                    Wallets hand out a fresh address each time you ask for one, and only that exact
                    address signs you in or resets your password - a different one from the same wallet
                    will not. In Account you can add more addresses to your account once you are in.
                  </div>
                  <div>Guest users do not have profiles, settings, or watchlists saved across sessions.</div>
                  <div><span style={{ color: C.gray }}>Sessions last 24 hours</span> - reloading keeps you signed in; after 24h you&apos;ll sign in again. Only one active session per account (a new login signs the others out).</div>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 10, borderTop: `1px solid ${SURFACE.line}` }}>
                <div style={{ color: C.gray, fontSize: '13px', lineHeight: 1.5, flex: 1 }}>
                  Unified address (u1…) too long? Decode it into its transparent, Sapling &amp; Orchard receivers and copy the one you need.
                </div>
                <button style={{ ...btn(), flexShrink: 0 }} onClick={() => setShowDecoder(true)}>
                  Open decoder
                </button>
              </div>
            </>
          )}

          {/* WELCOME BACK */}
          {phase === 'welcome-back' && (
            <>
              <div style={{ color: C.cyan, fontSize: '15px', marginBottom: 12 }}>
                Welcome back,{' '}
                <span style={{ color: C.yellow }}>
                  {auth.displayName ?? (auth.walletAddress ? auth.walletAddress.slice(0, 16) + '…' : 'User')}
                </span>
                {auth.isVerified && <span style={{ color: C.green, marginLeft: 8, fontSize: '13px' }}>● VERIFIED</span>}
              </div>
              {auth.walletAddress && (
                <div style={{ color: C.dkgray, fontSize: '13px', marginBottom: 18, fontFamily: 'monospace' }}>
                  {auth.walletAddress.slice(0, 26)}…{auth.walletAddress.slice(-8)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btn('primary')} onClick={() => startBoot('back')}>Continue</button>
                <button style={btn()} onClick={() => { auth.logout(); setPhase('auth'); }}>Switch Account</button>
              </div>
            </>
          )}

          {/* OWNERSHIP VERIFY */}
          {phase === 'verify' && challenge && (
            <>
              {pollStatus === 'confirmed' ? (
                <div style={{ color: C.green, fontSize: '15px', textAlign: 'center', padding: '20px 0' }}>
                  ✓ OWNERSHIP VERIFIED
                </div>
              ) : pollStatus === 'expired' ? (
                <>
                  <div style={{ color: C.red, fontSize: '14px', marginBottom: 14 }}>Challenge expired. Please start over.</div>
                  <button style={btn()} onClick={backToAuth}>Back</button>
                </>
              ) : pollStatus === 'rejected' ? (
                <>
                  <div style={{ color: C.red, fontSize: '14px', marginBottom: 14 }}>{pollErr}</div>
                  <button style={btn()} onClick={backToAuth}>Start over</button>
                </>
              ) : pollStatus === 'code_sent' ? (
                <>
                  <div style={{ color: C.green, fontSize: '14px', marginBottom: 8 }}>
                    ✓ Payment received{payment && payment.confirmations > 0 ? ` (${payment.confirmations} confirmation${payment.confirmations === 1 ? '' : 's'})` : ''} - a verification code was sent to your address.
                  </div>
                  <div style={{ color: C.gray, fontSize: '13px', marginBottom: 12, lineHeight: 1.6 }}>
                    Check your wallet for an incoming memo from ZEC-OS. It contains a 6-digit code -
                    only your wallet can decrypt it. Enter it below.
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={lbl}>VERIFICATION CODE</label>
                    <input
                      style={{ ...input, fontSize: '18px', letterSpacing: 6, textAlign: 'center' }}
                      type="text" inputMode="numeric" maxLength={6} placeholder="······"
                      value={codeInput}
                      onChange={e => { setCodeInput(e.target.value.replace(/\D/g, '')); setCodeErr(''); }}
                      onKeyDown={e => e.key === 'Enter' && handleSubmitCode()}
                      autoComplete="off"
                    />
                  </div>
                  {codeErr && <div style={{ color: C.red, fontSize: '13px', marginBottom: 10 }}>{codeErr}</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={btn('verify')} disabled={loading} onClick={handleSubmitCode}>
                      {loading ? 'Checking…' : 'Verify code'}
                    </button>
                    <button style={btn()} onClick={backToAuth}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  {/* The state of the payment, every 15 seconds. Three things a
                      person can act on: has it been seen, is it confirmed yet,
                      and when did we last look. */}
                  <ProgressLine payment={payment} lastPoll={lastPoll} />
                  <div style={{ color: C.gray, fontSize: '13px', marginBottom: 12 }}>
                    {challenge.kind === 'shielded'
                      ? <>Send exactly this amount <span style={{ color: C.yellow }}>with the memo below</span> to begin verification. A code will be sent back to your address. Expires in {Math.max(0, Math.ceil((challenge.expiresAt - Date.now()) / 60000))} min.</>
                      : <>Send exactly this amount <span style={{ color: C.yellow }}>from the address you are verifying</span>. Expires in {Math.max(0, Math.ceil((challenge.expiresAt - Date.now()) / 60000))} min.</>}
                  </div>
                  <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...input, marginBottom: 8, background: SURFACE.raised, cursor: 'text' }}>
                        <span style={{ color: C.dkgray }}>To:     </span>
                        <span style={{ color: C.yellow, wordBreak: 'break-all' }}>{challenge.toAddress}</span>
                      </div>
                      <div style={{ ...input, marginBottom: challenge.kind === 'shielded' ? 8 : 12, background: SURFACE.raised, cursor: 'text' }}>
                        <span style={{ color: C.dkgray }}>Amount: </span>
                        <span style={{ color: C.green }}>{challenge.valueZEC} ZEC</span>
                        <span style={{ color: C.dkgray }}> (exactly - unique nonce)</span>
                      </div>
                      {challenge.kind === 'shielded' && challenge.memoText && (
                        <div style={{ ...input, marginBottom: 12, background: SURFACE.raised, cursor: 'text' }}>
                          <span style={{ color: C.dkgray }}>Memo:   </span>
                          <span style={{ color: C.cyan, wordBreak: 'break-all' }}>{challenge.memoText}</span>
                        </div>
                      )}
                      <a
                        href={challenge.zip321}
                        onClick={e => { e.preventDefault(); tryOpenWallet(challenge.zip321); }}
                        style={{ color: C.cyan, fontSize: '13px', display: 'block', textDecoration: 'none', cursor: 'pointer' }}
                      >
                        ▶ Open in wallet (ZIP-321{challenge.kind === 'shielded' ? ' - memo prefilled' : ''})
                      </a>
                      {walletMsg && (
                        <div style={{ color: C.red, fontSize: '12px', marginTop: 8, lineHeight: 1.6 }}>
                          {walletMsg}
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'center', maxWidth: 172 }}>
                      <div
                        onClick={() => setShowBigQr(true)}
                        title="Click to enlarge"
                        style={{ cursor: 'zoom-in', display: 'inline-block' }}
                      >
                        <ZecQr value={challenge.zip321} size={148} />
                      </div>
                      <div style={{ color: C.gray, fontSize: '12px', marginTop: 6 }}>
                        Scan with your Zcash wallet · click to enlarge
                      </div>
                      <div style={{ color: C.dkgray, fontSize: '12px', marginTop: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <span>Your phone&apos;s camera app won&apos;t work</span>
                        <button
                          onClick={() => setShowZodlInfo(true)}
                          title="How to scan in zodl"
                          style={{
                            background: 'transparent', border: `1px solid ${C.cyan}`, color: C.cyan,
                            fontFamily: 'monospace', fontSize: '14px', width: 22, height: 22,
                            borderRadius: '50%', cursor: 'pointer', flexShrink: 0, lineHeight: 1, padding: 0,
                          }}
                        >
                          i
                        </button>
                      </div>
                    </div>
                  </div>
                  {/*
                    * The same three states the card above shows, said in one
                    * line. It used to read "Watching for your payment memo…"
                    * from the moment the QR appeared until the code arrived -
                    * true at the start and a lie for the rest of it, while the
                    * card beside it already knew the payment had been seen.
                    */}
                  <div style={{ color: paymentDone ? C.green : C.yellow, fontSize: '13px', marginBottom: 4 }}>
                    <span style={{ marginRight: 6 }}>{paymentDone ? '✓' : payment?.seen ? '◐' : '●'}</span>
                    {paymentDone
                      ? 'Payment confirmed - sending your code now…'
                      : payment?.seen
                        ? 'Payment seen - waiting for it to be mined…'
                        : challenge.kind === 'shielded' ? 'Watching for your payment memo…' : 'Polling Zaino for payment…'}
                  </div>
                  <div style={{ color: C.gray, fontSize: '12px', marginBottom: 4, lineHeight: 1.6 }}>
                    Verification speed depends on the network - it generally takes a few minutes at most.
                    The challenge (QR included) stays valid for {Math.max(0, Math.ceil((challenge.expiresAt - Date.now()) / 60000))} more min.
                  </div>
                  <div style={{ color: C.gray, fontSize: '12px', marginBottom: 4, lineHeight: 1.6 }}>
                    {resetting
                      ? <>You&apos;re resetting a password, so this proves the account is yours. Once the
                          code lands you&apos;ll choose a new one - your account, Pools and settings are
                          untouched.</>
                      : <>This is a <span style={{ color: C.yellow }}>one-time</span> step: once verified, you can set a
                          password and sign in from any device without verifying again.</>}
                  </div>
                  <div style={{ color: C.dkgray, fontSize: '12px', marginBottom: 16 }}>
                    Having trouble verifying? Contact the admin for help.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={btn('primary')} onClick={backToAuth}>Cancel</button>
                  </div>
                </>
              )}
            </>
          )}

          {/* SET PASSWORD (offered once, right after ownership verification) */}
          {phase === 'set-password' && (
            <>
              <div style={{ color: C.green, fontSize: '14px', marginBottom: 6 }}>
                {resetting
                  ? <>✓ That&apos;s you{auth.displayName ? <> - welcome back, <span style={{ color: C.yellow }}>{auth.displayName}</span></> : null}.</>
                  : <>✓ Ownership verified.</>}
              </div>
              <div style={{ color: C.gray, fontSize: '13px', marginBottom: 14, lineHeight: 1.6 }}>
                {resetting
                  ? <>Choose a new password. Your account, your Pools and your settings are exactly as
                      you left them - only the password changes, and the old one stops working.</>
                  : <>Set a password so you can sign in from any device without repeating the payment
                      verification. Also available in the Account app.</>}
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>{resetting ? 'NEW PASSWORD (min 8 chars)' : 'PASSWORD (min 8 chars)'}</label>
                  <input
                    style={input} type="password" placeholder="········"
                    value={newPw}
                    onChange={e => { setNewPw(e.target.value); setPwErr(''); }}
                    autoComplete="new-password"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>CONFIRM</label>
                  <input
                    style={input} type="password" placeholder="········"
                    value={newPwConfirm}
                    onChange={e => { setNewPwConfirm(e.target.value); setPwErr(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleSetPassword(false)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              {pwErr && <div style={{ color: C.red, fontSize: '13px', marginBottom: 10 }}>{pwErr}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btn('primary')} disabled={loading} onClick={() => handleSetPassword(false)}>
                  {loading ? 'Saving…' : resetting ? 'Save new password' : 'Set password'}
                </button>
                <button style={btn('primary')} disabled={loading} onClick={() => handleSetPassword(true)}
                  title={resetting ? 'Carry on without changing it - the old password still works' : undefined}>
                  {resetting ? 'Keep the old one' : 'Skip for now'}
                </button>
              </div>
            </>
          )}

          {/* BOOTING */}
          {phase === 'booting' && (
            <>
              {welcome && auth.displayName && (
                <div style={{ color: C.yellow, fontSize: '17px', marginBottom: 14, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                  {welcome.kind === 'back' ? 'Welcome back, ' : 'Welcome, '}{auth.displayName}
                  <UserBadges keys={welcome.badges} size={18} />
                </div>
              )}
              <div style={{ color: C.green, fontSize: '15px', marginBottom: 4 }}>Initializing...</div>
              <div style={{ color: C.dkgray, fontSize: '12px', marginBottom: 16 }}>Loading ZEC-OS workspace</div>
              <div style={{ width: '100%', height: 10, borderRadius: 6, overflow: 'hidden',
                border: `1px solid ${SURFACE.line}`, background: SURFACE.raised, marginBottom: 16 }}>
                <div style={{ height: '100%', background: C.yellow, width: `${progress}%`, transition: 'width 0.2s ease' }} />
              </div>
              <div style={{ color: '#AA8800', fontSize: '13px', opacity: 0.75 }}>Press ENTER to skip</div>
            </>
          )}

        </div>
      </div>

      {/* ── Enlarged QR overlay - click anywhere to dismiss ──────────────── */}
      {showBigQr && challenge && (
        <div
          style={{ position: 'absolute', inset: 0, background: 'rgba(20,16,11,0.78)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, zIndex: 30, cursor: 'zoom-out' }}
          onClick={() => setShowBigQr(false)}
        >
          <ZecQr value={challenge.zip321} size={Math.min(360, typeof window !== 'undefined' ? window.innerWidth - 100 : 360)} />
          <div style={{ color: C.gray, fontSize: '13px' }}>
            Scan with your Zcash wallet - click anywhere to close
          </div>
        </div>
      )}

      {/* ── zodl scan help overlay ────────────────────────────────────────── */}
      {showZodlInfo && (
        <div
          style={{ position: 'absolute', inset: 0, background: 'rgba(20,16,11,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}
          onClick={() => setShowZodlInfo(false)}
        >
          <div
            style={{ width: 420, maxWidth: '92vw', borderRadius: 12, overflow: 'hidden',
              border: `1px solid ${SURFACE.line}`, background: SURFACE.panel,
              boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ background: SURFACE.raised, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${SURFACE.line}` }}>
              <span style={{ color: C.yellow, fontSize: '14px' }}>SCANNING WITH ZODL</span>
              <button
                style={{ background: 'transparent', border: `1px solid ${C.cyan}`, color: C.cyan, fontFamily: 'monospace', fontSize: '13px', padding: '2px 10px', cursor: 'pointer' }}
                onClick={() => setShowZodlInfo(false)}
              >
                ✕ Close
              </button>
            </div>
            <div style={{ padding: '14px 16px', color: C.gray, fontSize: '13px', lineHeight: 1.8 }}>
              <div style={{ color: C.yellow, marginBottom: 8 }}>These steps are for the zodl wallet only.</div>
              <div>1. Open <span style={{ color: C.cyan }}>zodl</span> on your phone.</div>
              <div>2. Go to <span style={{ color: C.cyan }}>Send</span>.</div>
              <div>3. Tap the <span style={{ color: C.cyan }}>scan / QR</span> button.</div>
              <div>4. Point your phone at the QR code on this screen.</div>
              <div style={{ marginTop: 10, color: C.dkgray }}>
                The address, exact amount, and memo fill in automatically - just confirm the send.
                Your phone&apos;s regular camera app will not fill in the payment; you must scan from inside the wallet.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── UA decoder overlay - rendered above the auth box ─────────────── */}
      {showDecoder && (
        <div
          style={{ position: 'absolute', inset: 0, background: 'rgba(20,16,11,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
          onClick={() => setShowDecoder(false)}
        >
          <div
            style={{ width: 620, maxWidth: '92vw', height: 480, maxHeight: '80vh',
              display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden',
              border: `1px solid ${SURFACE.line}`, background: SURFACE.panel,
              boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ background: SURFACE.raised, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${SURFACE.line}`, flexShrink: 0 }}>
              <span style={{ color: C.yellow, fontSize: '14px' }}>UA DECODER</span>
              <button
                style={{ background: 'transparent', border: `1px solid ${C.cyan}`, color: C.cyan, fontFamily: 'monospace', fontSize: '13px', padding: '2px 10px', cursor: 'pointer' }}
                onClick={() => setShowDecoder(false)}
              >
                ✕ Close
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <UaDecoder />
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
        input::placeholder { color: #555 !important; }
        input:focus { border-color: #f5cf72 !important;
          box-shadow: 0 0 0 3px rgba(245,207,114,.18) !important; }
        input:hover:not(:focus) { border-color: #d18a45 !important; }
        input::placeholder { color: #6d7f79; }
        button { transition: filter .2s ease-in-out, background-color .2s ease-in-out,
                             border-color .2s ease-in-out, color .2s ease-in-out; }
        button:hover:not(:disabled) { filter: brightness(1.08); }
        button:active:not(:disabled) { filter: brightness(0.94); }
        button:hover { opacity: 0.85; }
      `}</style>
    </div>
  );
}
