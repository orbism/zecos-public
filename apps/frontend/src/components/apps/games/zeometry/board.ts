import { useAuthStore } from '@/store/authStore';
import type { Mode } from './engine';

/**
 * The leaderboard. Scores go to the ZEC-OS backend (`/api/zeometry/*`,
 * verified accounts only), which keeps a weekly and an all-time board per
 * mode and checks each run's numbers against what is possible. Until the
 * backend has those routes (docs/backend/zeometry.md), the board falls back
 * to this browser's own best runs and says so.
 *
 * Solo scores also go to any running tournament for the game, through the
 * contest system the other games use.
 */

export type Period = 'week' | 'all';
export interface Row { rank: number; name: string; badges?: string[]; score: number; wave: number; ship?: string; mine?: boolean }
export interface Board { rows: Row[]; global: boolean }
export interface Run {
  mode: Mode; score: number; wave: number; ship: string; seconds: number;
  /** What the server checks the score against. */
  kills: Record<string, number>; notes: number; bombs: number; peakMult: number;
  /** Everyone in it, for co-op and versus boards. */
  players?: string[];
}

const LOCAL = 'zec-zeometry-local-board';
type Local = { name: string; score: number; wave: number; ship: string; mode: Mode; at: number };
function readLocal(): Local[] { try { return JSON.parse(localStorage.getItem(LOCAL) ?? '[]') as Local[]; } catch { return []; } }

function weekStart(): number {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
}

export async function loadBoard(mode: Mode, period: Period): Promise<Board> {
  const { sessionToken } = useAuthStore.getState();
  try {
    const r = await fetch(`/api/zeometry/board?mode=${mode}&period=${period}`, { headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}, cache: 'no-store' });
    if (r.ok) { const d = await r.json() as { rows?: Row[] }; if (Array.isArray(d.rows)) return { rows: d.rows, global: true }; }
  } catch { /* fall through */ }
  const me = useAuthStore.getState().displayName ?? 'you';
  const since = period === 'week' ? weekStart() : 0;
  const rows = readLocal().filter((x) => x.mode === mode && x.at >= since).sort((a, b) => b.score - a.score).slice(0, 10)
    .map((x, i) => ({ rank: i + 1, name: x.name, score: x.score, wave: x.wave, ship: x.ship, mine: x.name === me }));
  return { rows, global: false };
}

/** Saves a run: to the global board if it can, always to this browser's. Returns the rank, if the server gives one. */
/** `note` says why a run did not reach the global board, when it did not. */
export async function submitRun(run: Run): Promise<{ rank: number | null; best: boolean; note: string | null }> {
  const { sessionToken, isVerified, isGuest, displayName } = useAuthStore.getState();
  const local = readLocal();
  const prevBest = Math.max(0, ...local.filter((x) => x.mode === run.mode).map((x) => x.score));
  local.push({ name: displayName ?? 'you', score: run.score, wave: run.wave, ship: run.ship, mode: run.mode, at: Date.now() });
  try { localStorage.setItem(LOCAL, JSON.stringify(local.sort((a, b) => b.score - a.score).slice(0, 60))); } catch { /* private mode */ }
  let rank: number | null = null, note: string | null = null;
  if (!(sessionToken && isVerified && !isGuest)) note = 'Saved in this browser. Verify your account to get on the global board.';
  else {
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` };
    try {
      const r = await fetch('/api/zeometry/runs', { method: 'POST', headers: auth, body: JSON.stringify(run) });
      const d = await r.json().catch(() => ({})) as { rank?: number | null; error?: string };
      // the backend answers 401 for both no session and an unverified account; 422 for a run that doesn't add up; 429 for too soon
      if (r.ok) rank = d.rank ?? null;
      else if (r.status === 401) note = 'Not saved: this needs a verified account.';
      else if (r.status === 422) note = `Not saved: ${d.error ?? 'that run does not add up.'}`;
      else if (r.status === 429) note = 'Not saved: one run every 20 seconds. Breathe.';
      else note = 'The leaderboard did not answer. Saved in this browser.';
    } catch { note = 'The leaderboard did not answer. Saved in this browser.'; }
    if (run.mode === 'solo') fetch('/api/contest/score', { method: 'POST', headers: auth, body: JSON.stringify({ game: 'zeometry', score: run.score }) }).catch(() => {});
  }
  return { rank, best: run.score > prevBest, note };
}
