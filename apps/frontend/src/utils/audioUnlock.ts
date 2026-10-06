/**
 * Deferred audio start for pages that load without a user gesture.
 *
 * Browsers refuse `HTMLAudioElement.play()` and keep an `AudioContext`
 * suspended until the user has interacted with the document. Inside the desktop
 * that's never a problem - you clicked an icon to open the app, so audio is
 * already unlocked. A standalone route loads straight into the app with zero
 * interaction, so playback is rejected and (because the rejection is swallowed)
 * fails silently.
 *
 * Anything queued here is retried on the first real interaction instead.
 */

const pendingAudio = new Set<HTMLAudioElement>();
const pendingResumes = new Set<() => void>();

const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;
let listening = false;

function flush() {
  stopListening();
  for (const el of pendingAudio) {
    // Skip anything the caller has since stopped.
    el.play().catch(() => { /* still blocked, or the element is gone */ });
  }
  pendingAudio.clear();
  for (const fn of pendingResumes) {
    try { fn(); } catch { /* resume is best-effort */ }
  }
  pendingResumes.clear();
}

function startListening() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  for (const ev of GESTURES) {
    window.addEventListener(ev, flush, { passive: true });
  }
}

function stopListening() {
  if (!listening || typeof window === 'undefined') return;
  listening = false;
  for (const ev of GESTURES) {
    window.removeEventListener(ev, flush);
  }
}

/**
 * Play now if allowed; otherwise queue and start on the first user gesture.
 * Pair with `cancelPendingAudio` in cleanup so a closed screen can't come back
 * to life later.
 */
export function playWhenAllowed(el: HTMLAudioElement): void {
  el.play().catch(() => {
    pendingAudio.add(el);
    startListening();
  });
}

export function cancelPendingAudio(el: HTMLAudioElement): void {
  pendingAudio.delete(el);
}

/** Run `fn` once audio is permitted - used to resume a suspended AudioContext. */
export function whenAudioAllowed(fn: () => void): void {
  pendingResumes.add(fn);
  startListening();
}
