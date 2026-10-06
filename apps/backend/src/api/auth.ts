import { FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { findUserByAddress, addProvenAddress } from '../lib/userAddress';
import { getLightdInfo, getLatestBlock, getAddressUtxos, nodeFromSubversion } from '../zaino/client';
import { getSenderAddresses, txidBufferToHex } from '../lib/txSender';
import { walletConfigured, backendZaddr, zListReceivedByAddress, zSendMany, decodeMemoHex, canReceiveMemo, looksLikeAddress, findOutgoing } from '../wallet/rpc';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../lib/password';
import { clientIp, getUser } from './user';
import { noteActivity } from '../lib/activity';
import { handleReservedFor, isAdmin, canViewAdmin } from '../lib/admin';
import { getRegistration, closedMessage } from '../lib/registration';
import { rateLimiter } from '../lib/ratelimit';
import { findFundingNote, withClaim } from '../lib/paymentClaim';
import { netOf } from '../wallet/requestNetwork';
import { allowedNetworks, NotSentError, type BackendNetwork } from '../wallet/zallet';

/**
 * The transparent receiving address for this network (audit M12).
 * BACKEND_TADDR_TESTNET / BACKEND_TADDR_MAINNET name each; the plain
 * BACKEND_TADDR still works for the network it belongs to (tm/t2 is testnet),
 * so a transparent verification is never pointed at the other chain.
 */
function backendTaddr(net: BackendNetwork): string | undefined {
  const own = (process.env[net === 'testnet' ? 'BACKEND_TADDR_TESTNET' : 'BACKEND_TADDR_MAINNET'] ?? '').trim();
  if (own) return own;
  const plain = (process.env.BACKEND_TADDR ?? '').trim();
  return plain && (net === 'testnet') === /^t[m2]/.test(plain) ? plain : undefined;
}

/**
 * A recipient plus an OPTIONAL memo.
 *
 * Zallet rejects a memo on a transparent recipient outright, and every one of
 * these addresses is user-supplied and may be either kind. Dropping the memo is
 * always better than failing the send: the payment is the obligation, the label
 * is a courtesy.
 */
function payTo(address: string, amount: number, memo: string) {
  return canReceiveMemo(address) ? { address, amount, memo } : { address, amount };
}




const ZEC_ADDR_RE = /^(t1|t3|u1|zs1)[a-zA-Z0-9]{30,}/;
export function isValidZecAddress(a: string) { return ZEC_ADDR_RE.test(a.trim()); }
function isShieldedAddress(a: string) { return /^(u1|zs1)/.test(a.trim()); }
function generateNonce() { return crypto.randomBytes(16).toString('hex'); }
function generateCode() { return String(crypto.randomInt(100000, 1000000)); }
/*
 * What a verification costs the payer, and why it has a floor.
 *
 * Proving an address means sending us a dust payment; we answer with a dust
 * memo carrying the code. That answer costs the backend wallet the dust it
 * sends PLUS a ZIP-317 fee (5,000 zat per logical action, so 10,000 on a
 * typical one-in two-out shielded send). At the old floor of 10,000 zat a
 * verification took in less than the reply cost and the auth wallet lost about
 * 10,000 zat every time - slowly draining the address that has to be able to
 * answer.
 *
 * So the ask starts above reply + fee + a surplus, and the amount stays random
 * inside a wide band because the TRANSPARENT flow identifies a payment by its
 * exact amount.
 */
const REPLY_DUST_ZAT = 10_000;
/** ZIP-317 on the reply, with headroom for a send that needs more than the grace actions. */
const REPLY_FEE_ZAT = 15_000;
/** Left over after answering, so proving an address funds the wallet that answers. */
const REPLY_SURPLUS_ZAT = 10_000;
const MIN_CHALLENGE_ZAT = REPLY_DUST_ZAT + REPLY_FEE_ZAT + REPLY_SURPLUS_ZAT;   // 35,000 zat = 0.00035 ZEC
/** Top of the band, unchanged: still under 0.001 ZEC. */
const MAX_CHALLENGE_ZAT = 99_999;
function uniqueValueZat() {
  return MIN_CHALLENGE_ZAT + Math.floor(Math.random() * (MAX_CHALLENGE_ZAT - MIN_CHALLENGE_ZAT + 1));
}
function sessionExpiry() {
  const h = parseInt(process.env.SESSION_EXPIRY_HOURS || '24'); // sessions time out after 24h
  return new Date(Date.now() + h * 3600 * 1000);
}

// How long the QR/challenge is shown as "live" (the poll window). Configurable -
// 15 min was too short for wallet UX + confirmation time. A payment that lands
// LATER is still honored by the reconciler (below), regardless of this.
const CHALLENGE_TTL_MS = Math.max(1, parseInt(process.env.CHALLENGE_TTL_MINUTES || '60')) * 60 * 1000;
// Background reconciler cadence + how long a paid-late nonce stays honorable.
const AUTH_RECONCILE_MS = Math.max(30, parseInt(process.env.AUTH_RECONCILE_SECONDS || '150')) * 1000;
const CHALLENGE_HONOR_MS = Math.max(1, parseInt(process.env.CHALLENGE_HONOR_DAYS || '30')) * 24 * 3600 * 1000;
const DUST_REPLY_ZEC = REPLY_DUST_ZAT / 100_000_000;
const MAX_CODE_TRIES = 5;

/*
 * Testnet prefixes, mirroring looksLikeAddress. Only used to refuse them at
 * account creation with an explanation, rather than as a bare "invalid".
 */
export const TESTNET_ADDR_RE = /^(utest1|ztestsapling1|tm|tn|tr)/i;

/**
 * Spend one code attempt FIRST, atomically, then judge it.
 *
 * Shared by login and by linking so the attempt cap cannot drift between them.
 * The old order (read the counter, compare, then increment) let a burst of
 * concurrent guesses all see "4 tries used" and all be judged.
 */
async function spendCodeAttempt(
  challenge: { id: string; code: string | null },
  code: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const bumped = await prisma.authChallenge.update({ where: { id: challenge.id }, data: { codeTries: { increment: 1 } } });
  if (bumped.codeTries > MAX_CODE_TRIES)
    return { ok: false, status: 429, error: 'Too many attempts - start a new verification' };
  if (challenge.code !== code.trim()) {
    const left = MAX_CODE_TRIES - bumped.codeTries;
    return { ok: false, status: 401, error: `Incorrect code - ${left} attempt${left === 1 ? '' : 's'} left` };
  }
  return { ok: true };
}

// The shielded funding processor - scans for a challenge's `zec-os-auth-<nonce>`
// memo and drives pending → funded → code_sent (atomic claim + dust/code reply +
// rollback on send failure). Module-scope so BOTH the poll handler and the
// background reconciler use the exact same idempotent path. `notes` may be
// pre-fetched (the reconciler shares one scan across many challenges).
type ChallengeWithUser = { id: string; nonce: string; status: string; valueZat: number; linkAddress?: string | null; user: { address: string } };

/**
 * Send a challenge the code it ALREADY has, as a dust memo.
 *
 * Never mints one: the only PIN that can be redeemed is the one in
 * AuthChallenge.code, because /verify-code compares against that column. A
 * fresh code here would lock out anyone holding the first.
 *
 * To the address being PROVEN - the link address when there is one, otherwise
 * the account's own. zSendMany keys idempotency on from|to|amount|memo, so an
 * operator resending inside that window resolves to the original send rather
 * than paying twice.
 *
 * Exported for the operator surface (api/auth-ops.ts, the wallet manager's
 * resend button); shared with the funding path below so there is one way a code
 * ever leaves this box.
 */
export async function deliverCode(
  walletNet: BackendNetwork,
  challenge: { code: string | null; linkAddress?: string | null; user: { address: string } },
): Promise<void> {
  if (!challenge.code) throw new Error('challenge has no code to deliver');
  await zSendMany(backendZaddr(walletNet), [
    payTo(challenge.linkAddress ?? challenge.user.address, DUST_REPLY_ZEC, `ZEC-OS verification code: ${challenge.code}`),
  ], walletNet);
}

/** Exported for api/auth-ops.ts: the operator's "check funding now" is this exact path. */
/**
 * The account's incoming notes, cached briefly and shared.
 *
 * Every verification poll used to cost its own wallet read, and the answer is
 * the same list for everyone on that network. Ten seconds is short enough that
 * a payment is never sitting undetected for long, and long enough that a modal
 * polling every fifteen seconds - and five of them at once - costs the wallet
 * one read rather than five.
 */
type Notes = Awaited<ReturnType<typeof zListReceivedByAddress>>;
const NOTES_TTL_MS = 10_000;
const noteCache = new Map<BackendNetwork, { at: number; notes: Notes }>();
/**
 * Single-flight: concurrent callers await the SAME read rather than each
 * starting one. The cache alone does not cover this - a cold window with five
 * polls arriving together is five wallet reads, and the wallet has one lane.
 */
const notesInFlight = new Map<BackendNetwork, Promise<Notes>>();
async function recentNotes(walletNet: BackendNetwork): Promise<Notes> {
  const hit = noteCache.get(walletNet);
  if (hit && Date.now() - hit.at < NOTES_TTL_MS) return hit.notes;
  const running = notesInFlight.get(walletNet);
  if (running) return running;
  // minconf 0: an unmined note counts as zero confirmations rather than being
  // dropped, which is what lets the poll say "seen, 0 of 1" instead of nothing.
  const p = zListReceivedByAddress(backendZaddr(walletNet), 0, walletNet)
    .then((notes) => { noteCache.set(walletNet, { at: Date.now(), notes }); return notes; })
    .finally(() => { notesInFlight.delete(walletNet); });
  notesInFlight.set(walletNet, p);
  return p;
}

/**
 * How far along a challenge's payment is, for the screen the payer is watching.
 *
 * `confirmations` is the funding note's own count; CONFIRMATIONS_NEEDED is what
 * the code waits for. A sighting reported by the memo-watch sidecar shows up
 * here too, so the modal can say "payment seen" within a second of broadcast
 * rather than after a block.
 */
export const CONFIRMATIONS_NEEDED = 1;
export async function fundingProgress(
  walletNet: BackendNetwork,
  challenge: { nonce: string; valueZat: number; seenTxid?: string | null; seenAt?: Date | null },
): Promise<{ seen: boolean; txid: string | null; confirmations: number; needed: number }> {
  const base = { needed: CONFIRMATIONS_NEEDED };
  try {
    const marker = `zec-os-auth-${challenge.nonce}`;
    const note = (await recentNotes(walletNet))
      .filter((n) => decodeMemoHex(n.memo).trim() === marker && (n.amountZat ?? 0) >= challenge.valueZat)
      .sort((a, b) => b.confirmations - a.confirmations)[0];
    if (note) return { ...base, seen: true, txid: note.txid, confirmations: note.confirmations };
  } catch {
    // The wallet cannot say right now. The sighting below may still answer.
  }
  if (challenge.seenTxid) return { ...base, seen: true, txid: challenge.seenTxid, confirmations: 0 };
  return { ...base, seen: false, txid: null, confirmations: 0 };
}

export async function processShieldedFunding(
  // Explicit, never inherited: this runs from both a request poll and the
  // background reconciler, and the reconciler has no request to read it from.
  walletNet: BackendNetwork,
  challenge: ChallengeWithUser,
  notes?: Awaited<ReturnType<typeof zListReceivedByAddress>>,
  logWarn: (o: unknown, m: string) => void = () => {},
): Promise<'code_sent' | 'pending' | 'not_funded'> {
  if (challenge.status === 'code_sent') return 'code_sent';
  if (challenge.status === 'funded') return 'pending'; // code send in flight
  try {
    /*
     * Confirmed notes only, whatever the caller handed in. The poll now reads
     * the wallet at minconf 0 so it can show progress, and a code sent against
     * an unmined payment would be a code sent against a payment that can still
     * disappear.
     */
    const ns = (notes ?? (await recentNotes(walletNet))).filter((n) => n.confirmations >= CONFIRMATIONS_NEEDED);
    const marker = `zec-os-auth-${challenge.nonce}`;
    /*
     * Funding means: the whole memo IS the marker, the note carries at least
     * the challenge amount, and the note has not funded anything else. Each
     * hit here makes the wallet SEND (the code memo), so a substring match
     * with no amount check let one zatoshi carrying eleven markers buy eleven
     * sends - a drain on the fee side. See lib/paymentClaim.
     */
    const funded = await findFundingNote(walletNet, ns, marker, challenge.valueZat, challenge.id);
    if (!funded) return 'not_funded';
    const code = generateCode();
    // Atomic claim: exactly one worker (poll or reconciler) transitions pending → funded.
    const claimed = await withClaim({ network: walletNet, txid: funded.txid, noteRef: funded.noteRef, purpose: 'auth', orderKey: challenge.id }, async (tx) => (
      await tx.authChallenge.updateMany({
        where: { network: walletNet, id: challenge.id, status: 'pending' },
        data: { status: 'funded', fundedTxid: funded.txid, code },
      })
    ).count);
    if (claimed !== 1) return 'pending';
    deliveringCodes.add(challenge.id);
    try {
      await deliverCode(walletNet, { ...challenge, code });
    } catch (sendErr) {
      /*
       * Released ONLY when the send was refused before it was issued (audit
       * M3). A timed-out send may already be out; releasing it minted a NEW
       * code on the retry, so two different codes could reach the user. The
       * row stays 'funded' with its code, and resumeFundedChallenges finishes
       * it - finding the memo in the wallet, or resending the SAME code.
       */
      if (sendErr instanceof NotSentError) {
        await prisma.authChallenge.update({ where: { id: challenge.id }, data: { status: 'pending', code: null } });
      }
      throw sendErr;
    } finally {
      deliveringCodes.delete(challenge.id);
    }
    await prisma.authChallenge.update({ where: { id: challenge.id }, data: { status: 'code_sent' } });
    return 'code_sent';
  } catch (e) {
    logWarn({ err: e }, 'shielded funding check failed');
    return 'pending';
  }
}

// Background reconciler: scans incoming wallet memos and services ANY pending
// shielded challenge whose payment has arrived - independent of the frontend and
// regardless of the display TTL. This is what makes late / tab-closed payments
// still get their code. Also sweeps away never-paid, long-expired challenges.
/**
 * Background reconciler.
 *
 * Takes its network as an argument because it has no request to read one from.
 * `startAuthReconciler` runs one per allowed network, so a testnet payment is
 * reconciled against the testnet wallet and never against mainnet's.
 */
/** Automatic resends per challenge. After this it waits for a human (it shows in /api/health as authFunded). */
const MAX_CODE_RESENDS = 3;

/** Challenges whose code send is in progress in this process: never resumed underneath it. */
const deliveringCodes = new Set<string>();

/**
 * Finish challenges left 'funded' (audit M3): paid, code minted, and the send
 * either timed out or the process died mid-send. They used to answer 'pending'
 * forever. The wallet's own history says whether the code memo went out; if it
 * did the challenge is marked sent, if not the SAME code is sent again - so the
 * worst case is one code arriving twice, never two different codes.
 */
async function resumeFundedChallenges(walletNet: BackendNetwork): Promise<void> {
  const stuck = await prisma.authChallenge.findMany({
    // Past the resend cap they are still LOOKED UP (never resent): a code that
    // did arrive then clears, instead of raising a false "needs a human".
    where: { network: walletNet, kind: 'shielded', status: 'funded', code: { not: null }, createdAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    include: { user: true }, orderBy: { createdAt: 'desc' }, take: 50,
  });
  for (const c of stuck) {
    if (deliveringCodes.has(c.id)) continue;
    deliveringCodes.add(c.id);
    try {
      const to = c.linkAddress ?? c.user.address;
      // Throws while the wallet is behind: a miss then means nothing, so nothing is resent.
      const sent = await findOutgoing(walletNet, to, REPLY_DUST_ZAT, c.code!, c.createdAt);
      if (!sent && c.codeSends >= MAX_CODE_RESENDS) continue;
      if (!sent) {
        // Counted BEFORE the send, so even a send that hangs uses up an attempt.
        const { count } = await prisma.authChallenge.updateMany({ where: { id: c.id, status: 'funded', codeSends: { lt: MAX_CODE_RESENDS } }, data: { codeSends: { increment: 1 } } });
        if (count === 0) continue;
        await deliverCode(walletNet, c);
      }
      await prisma.authChallenge.updateMany({ where: { id: c.id, status: 'funded' }, data: { status: 'code_sent' } });
      console.log(`[auth] resumed funded challenge ${c.nonce}: code ${sent ? 'was already sent' : 'sent'}`);
    } catch (e) {
      console.warn(`[auth] could not resume funded challenge ${c.nonce}`, e);
    } finally {
      deliveringCodes.delete(c.id);
    }
  }
}

async function reconcileAuthMemos(walletNet: BackendNetwork) {
  if (!walletConfigured(walletNet)) return;
  await resumeFundedChallenges(walletNet).catch((e) => console.warn('[auth] funded-challenge resume failed', e));
  try {
    // The same cached read the polls use: one call serves every open challenge.
    const notes = await recentNotes(walletNet);
    const nonces = new Set<string>();
    for (const n of notes) {
      for (const m of decodeMemoHex(n.memo).matchAll(/zec-os-auth-([0-9a-f]{32})/g)) nonces.add(m[1]);
    }
    if (nonces.size) {
      const pending = await prisma.authChallenge.findMany({
        where: { network: walletNet, nonce: { in: [...nonces] }, kind: 'shielded', status: 'pending' },
        include: { user: true },
      });
      for (const c of pending) {
        try {
          const r = await processShieldedFunding(walletNet, c, notes, (o, msg) => console.warn('[auth]', msg, o));
          if (r === 'code_sent') console.log(`[auth] reconciler serviced late/unobserved payment for nonce ${c.nonce}`);
        } catch (e) { console.warn('[auth] reconciler failed for', c.nonce, e); }
      }
    }
  } catch (e) { console.warn('[auth] reconciler scan failed', e); }
  // Sweep: never-paid challenges older than the honor window (keep funded/code_sent/verified).
  try {
    const r = await prisma.authChallenge.deleteMany({
      where: { status: 'pending', createdAt: { lt: new Date(Date.now() - CHALLENGE_HONOR_MS) } },
    });
    if (r.count) console.log(`[auth] swept ${r.count} stale unpaid challenge(s)`);
  } catch { /* ignore */ }
}
/**
 * One reconciler per network this deployment serves.
 *
 * A single global loop would only ever service one chain, so a testnet payment
 * on a dual-network box would sit unreconciled forever. Networks the box has
 * not opted into are simply absent from the list, so nothing extra runs on a
 * mainnet-only deployment.
 */
export function startAuthReconciler() {
  for (const walletNet of allowedNetworks()) {
    if (!walletConfigured(walletNet)) {
      console.log(`[auth] memo reconciler disabled for ${walletNet} (wallet not configured)`);
      continue;
    }
    reconcileAuthMemos(walletNet).catch(() => {});
    setInterval(() => reconcileAuthMemos(walletNet).catch(() => {}), AUTH_RECONCILE_MS);
    console.log(`[auth] memo reconciler started for ${walletNet} (every ${AUTH_RECONCILE_MS / 1000}s)`);
  }
}

// ── In-memory rate limiting ──────────────────────────────────────────────────
// Code guesses: 10 a minute per nonce and per caller, on top of the 5-try cap.
const codeLimiter = rateLimiter({ windowMs: 60_000, max: 10 });
/*
 * Per-IP budgets, in SEPARATE buckets per purpose.
 *
 * One shared counter meant a few mistyped passwords spent the budget for
 * verifying ownership - so the person who had just forgotten their password,
 * the one who most needs to re-verify, was the one told to come back later. A
 * household or VPN behind one address spent it faster still.
 *
 * Starting a verification is the expensive one (it can end in a memo the wallet
 * sends), so it keeps the tighter budget; a failed login costs nothing but a
 * hash. Both report how long is left, because "try again later" with no number
 * is indistinguishable from broken.
 */
const BUDGETS = {
  /** New verification invoices minted. Spent only when one is actually created. */
  challenge: { max: 10, windowMs: 3600_000 },
  /** Any call to the verification routes, as a plain anti-spam ceiling. */
  burst: { max: 60, windowMs: 3600_000 },
  login: { max: 20, windowMs: 900_000 },
} as const;
const ipHits = new Map<string, number[]>();
// Keys were never removed, so the map grew with every address that ever called
// (audit M7). Drop the ones whose hits have all aged out of the longest window.
const LONGEST_WINDOW_MS = Math.max(...Object.values(BUDGETS).map((b) => b.windowMs));
setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of ipHits) if (!hits.length || now - hits[hits.length - 1]! >= LONGEST_WINDOW_MS) ipHits.delete(k);
}, 10 * 60_000).unref();
function rateLimited(ip: string, kind: keyof typeof BUDGETS = 'challenge'): number {
  const { max, windowMs } = BUDGETS[kind];
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const hits = (ipHits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    ipHits.set(key, hits);
    return Math.max(1, Math.ceil((windowMs - (now - hits[0]!)) / 1000));
  }
  hits.push(now);
  ipHits.set(key, hits);
  return 0;
}

/** "in 12 minutes", "in 40 seconds" - so a refusal names its own end. */
function waitText(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return seconds < 90 ? `in ${Math.max(10, Math.round(seconds / 10) * 10)} seconds` : `in ${mins} minute${mins === 1 ? '' : 's'}`;
}

async function tooManyOpenChallenges(walletNet: BackendNetwork, userId: string): Promise<boolean> {
  const open = await prisma.authChallenge.count({
    where: { network: walletNet, userId, verified: false, expiresAt: { gt: new Date() } },
  });
  return open >= 3;
}

// Single-session policy: the newest login supersedes all older live sessions for
// the same user (kills copy-paste-token cheating / concurrent instances).
const ACTIVE_SESSION_MS = 90 * 1000; // "logged in elsewhere" only counts sessions seen this recently

export async function revokeOtherSessions(userId: string, keepToken: string): Promise<number> {
  const now = new Date();
  // Count ONLY other sessions that were genuinely active recently (open tabs
  // heartbeat via getUser / the /session poll). Stale, abandoned, or long-closed
  // tokens are NOT counted - so we don't falsely claim we "logged you out
  // elsewhere" when nothing was actually live.
  const activeCount = await prisma.userSession.count({
    where: {
      userId, token: { not: keepToken }, revokedAt: null,
      expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - ACTIVE_SESSION_MS) },
    },
  });
  // Still revoke ALL other live sessions (security - one active session per user).
  await prisma.userSession.updateMany({
    where: { userId, token: { not: keepToken }, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now, revokedReason: 'signed_in_elsewhere' },
  });
  return activeCount;
}

/**
 * A session token is a bearer credential and is generated like one: 256 bits
 * from the CSPRNG. The column's cuid() default (timestamp + counter +
 * fingerprint, ~2^41 of real entropy) stays only as a schema default and is
 * never used for a live session.
 */
function newSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

async function issueVerifiedSession(userId: string, challengeId: string) {
  const session = await prisma.userSession.create({ data: { userId, via: 'challenge', token: newSessionToken(), expiresAt: sessionExpiry() } });
  await prisma.authChallenge.update({
    where: { id: challengeId },
    data: { verified: true, status: 'verified', sessionId: session.token },
  });
  await prisma.user.update({ where: { id: userId }, data: { isVerified: true } });
  const signedOutOthers = await revokeOtherSessions(userId, session.token);
  return { session, signedOutOthers };
}

export async function authRoutes(server: FastifyInstance) {
  // Explicit logout - delete this session so it doesn't linger as a "live"
  // session and get miscounted as a signed-out-elsewhere on the next login.
  server.post('/logout', async (req, reply) => {
    const authHdr = req.headers.authorization;
    const token = authHdr?.startsWith('Bearer ') ? authHdr.slice(7) : null;
    if (token) await prisma.userSession.deleteMany({ where: { token } });
    return reply.send({ ok: true });
  });

  // Session liveness - the client polls this to learn if it was signed out by a
  // newer login elsewhere (vs merely expired), so it can show the right message.
  server.get('/session', async (req, reply) => {
    const authHdr = req.headers.authorization;
    const token = authHdr?.startsWith('Bearer ') ? authHdr.slice(7) : null;
    if (!token) return reply.send({ valid: false, reason: 'no_token' });
    const session = await prisma.userSession.findUnique({ where: { token }, include: { user: true } });
    if (!session) return reply.send({ valid: false, reason: 'unknown' });
    if (session.revokedAt) return reply.send({ valid: false, reason: session.revokedReason ?? 'revoked' });
    if (session.expiresAt < new Date()) return reply.send({ valid: false, reason: 'expired' });
    // What they are doing, as their browser reports it (see lib/activity).
    noteActivity(`u:${session.userId}`, req.headers['x-zec-activity']);
    // Heartbeat: keep this (open, polling) tab marked as recently active, so a
    // later login elsewhere correctly recognizes it as a live session.
    // This is the only route the Next proxy has always forwarded a real client
    // IP to, and it was being dropped - so the sysop roster had no IPs to show.
    if (Date.now() - session.lastSeenAt.getTime() > 30_000) {
      const ip = clientIp(req);
      prisma.userSession
        .update({ where: { token }, data: { lastSeenAt: new Date(), ...(ip ? { lastIp: ip } : {}) } })
        .catch(() => {});
    }
    // Which sysop views this browser may show; the routes behind them check again.
    const u = session.user;
    return reply.send({ valid: true, sysop: isAdmin(u), sudobud: canViewAdmin(u) && !isAdmin(u) });
  });

  // NOTE: POST /address (unverified session issuance) was removed deliberately.
  // Identity without proof of ownership is a client-side "local profile" only.

  server.post<{ Body: { address: string; displayName?: string } }>('/challenge', async (req, reply) => {
    const walletNet = netOf(req);
    const { address, displayName } = req.body ?? {};
    // Accounts are created from mainnet addresses only. A testnet address is
    // linked to an account that already exists, from Account, and says so.
    if (address && TESTNET_ADDR_RE.test(address.trim()))
      return reply.status(400).send({
        error: 'A testnet address cannot create an account. Verify with a mainnet address, then link a testnet address from Account.',
      });
    if (!address || !isValidZecAddress(address))
      return reply.status(400).send({ error: 'Invalid Zcash address' });

    /*
     * Only the ceiling here. The real budget is spent where a NEW invoice is
     * minted, further down: asking again for the invoice you already have is
     * what someone does when a page reloads or a wallet takes its time, and
     * charging for it is how a person with one open invoice ended up locked out
     * of their own account for an hour.
     */
    const burst = rateLimited(clientIp(req) || req.ip, 'burst');
    if (burst)
      return reply.status(429).send({
        error: `Too many requests from this connection - try again ${waitText(burst)}.`,
        retryInSeconds: burst,
      });

    const shielded = isShieldedAddress(address);
    if (shielded && !walletConfigured(walletNet))
      return reply.status(501).send({ error: 'Shielded verification not configured on this server' });

    const toAddress = shielded ? backendZaddr(walletNet) : backendTaddr(walletNet);
    if (!toAddress) return reply.status(503).send({ error: 'Payment receiving address not configured' });

    /*
     * Who owns this address already, if anyone - by the account's primary
     * column or by any address it has proven since. Resolved BEFORE the name
     * check, because "taken" has to mean taken by SOMEBODY ELSE: re-verifying
     * with your own alternate address and your own name was being refused as
     * an impostor.
     */
    const known = await findUserByAddress(address);

    /*
     * Registration closed by the sysop: only a NEW account is refused. A
     * verified account still re-verifies here to reset its password, so the
     * gate is on the account, not on this route. A challenge already paid
     * before the switch finishes normally - nobody is charged and turned away.
     */
    if (!known?.isVerified) {
      const reg = await getRegistration();
      // Paid already: a reload resumes that challenge through here, so let it.
      const paidAlready = !reg.open && known && await prisma.authChallenge.findFirst({
        where: { network: walletNet, userId: known.id, linkAddress: null, status: { in: ['funded', 'code_sent'] } },
        select: { id: true },
      });
      if (!reg.open && !paidAlready)
        return reply.status(403).send({ error: closedMessage(reg), code: 'registrations_closed', reopensAt: reg.reopensAt, message: reg.message });
    }

    const name = displayName?.trim() || null;
    const nameKey = name?.toLowerCase() ?? null;
    if (nameKey) {
      const holder = await prisma.user.findUnique({ where: { nameKey } });
      if (holder && holder.id !== known?.id && holder.address !== address.trim())
        return reply.status(409).send({ error: 'That display name is already taken' });
      if (handleReservedFor(nameKey, address.trim()))
        return reply.status(409).send({ error: 'That display name is already taken' });
    }

    let user;
    try {
      // An address this account has ALREADY proven resolves to it, rather than
      // creating a second account that then collides on the display name and
      // needs a sysop to untangle. Only a genuinely unknown address creates.
      // The name is taken ONLY on create. This route is unauthenticated - it
      // is how you START proving an address - so it must never modify an
      // existing row: anyone could rename any address. Renames go through the
      // authenticated PUT /user/profile.
      user = known ?? await prisma.user.upsert({
        where: { address: address.trim() },
        create: { address: address.trim(), displayName: name, nameKey },
        update: {},
      });
      /*
       * A name asked for on a row that has none yet.
       *
       * `update: {}` above means the name is applied ONLY on create, so anyone
       * whose address already had a stub row - an abandoned challenge from
       * weeks ago - typed a display name, verified, and ended up with a working
       * account carrying no name at all. Nothing said so, and the account then
       * could not be found by the name they thought they had chosen.
       *
       * Claiming an EMPTY name on an UNVERIFIED row is not a rename: there is
       * nothing to displace, and the row cannot become an account without
       * proving this address anyway. A verified row is left alone - renaming
       * that is the authenticated profile route's job, or anyone knowing an
       * address could scribble on a stranger's account.
       */
      if (nameKey && user && !user.displayName && !user.nameKey && !user.isVerified) {
        try {
          user = await prisma.user.update({ where: { id: user.id }, data: { displayName: name, nameKey } });
        } catch {
          // Taken between the check above and here. The challenge still stands;
          // the name simply is not theirs, and Account can set another.
        }
      }
    } catch {
      // Unique-constraint race on nameKey
      return reply.status(409).send({ error: 'That display name is already taken' });
    }

    /*
     * Hand back the challenge this account already has, rather than minting
     * another.
     *
     * A funded one first: someone who closed the tab after paying reopens
     * straight onto code entry, and their payment is not ignored.
     *
     * But an UNPAID one is handed back too, and that is the fix for the worst
     * corner of this flow. Every fresh attempt used to mint a new nonce with a
     * new amount, three of those filled the per-account cap, and the fourth was
     * refused for up to an hour - so someone resetting a forgotten password, who
     * had done nothing but open the screen three times, was locked out of the
     * one route back into their account. Returning the same nonce also means
     * there is only ever one invoice on screen to pay.
     */
    const mine = { network: walletNet, userId: user.id, kind: shielded ? 'shielded' : 'taddr', linkAddress: null };
    const paid = await prisma.authChallenge.findFirst({
      where: { ...mine, status: { in: ['funded', 'code_sent'] } },
      orderBy: { createdAt: 'desc' },
    })
      ?? await prisma.authChallenge.findFirst({
        where: { ...mine, status: 'pending', verified: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
    if (paid) {
      return reply.send({
        nonce: paid.nonce, valueZat: paid.valueZat, valueZEC: (paid.valueZat / 100_000_000).toFixed(8),
        toAddress: paid.toAddress, zip321: paid.zip321, kind: paid.kind,
        memoText: paid.kind === 'shielded' ? `zec-os-auth-${paid.nonce}` : undefined,
        expiresAt: paid.expiresAt.getTime(), resumed: true, status: paid.status,
      });
    }

    if (await tooManyOpenChallenges(walletNet, user.id))
      return reply.status(429).send({ error: 'Too many open challenges for this address' });

    // Minting a new one: this is the expensive act, so this is what is budgeted.
    const waitFor = rateLimited(clientIp(req) || req.ip, 'challenge');
    if (waitFor)
      return reply.status(429).send({
        error: `Too many new verifications from this connection - try again ${waitText(waitFor)}.`,
        retryInSeconds: waitFor,
      });

    const nonce = generateNonce();
    const valueZat = uniqueValueZat();
    const valueZEC = (valueZat / 100_000_000).toFixed(8);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const memoText = `zec-os-auth-${nonce}`;
    const zip321 = shielded
      ? `zcash:${toAddress}?amount=${valueZEC}&memo=${Buffer.from(memoText, 'utf8').toString('base64url')}`
      : `zcash:${toAddress}?amount=${valueZEC}&memo=zec-os-auth-${nonce.slice(0, 8)}`;

    await prisma.authChallenge.create({
      data: { network: walletNet, nonce, userId: user.id, kind: shielded ? 'shielded' : 'taddr', valueZat, toAddress, zip321, expiresAt },
    });
    return reply.send({
      nonce, valueZat, valueZEC, toAddress, zip321,
      kind: shielded ? 'shielded' : 'taddr',
      memoText: shielded ? memoText : undefined,
      expiresAt: expiresAt.getTime(),
    });
  });

  server.get<{ Params: { nonce: string } }>('/verify/:nonce', async (req, reply) => {
    const walletNet = netOf(req);
    const challenge = await prisma.authChallenge.findUnique({
      where: { network_nonce: { network: walletNet, nonce: req.params.nonce } },
      include: { user: true },
    });
    // A link challenge is not a login: it must never be able to mint a session.
    if (!challenge || challenge.linkAddress) return reply.status(404).send({ error: 'Challenge not found' });

    if (challenge.verified) {
      /*
       * The session token is handed out through this route AT MOST ONCE. It
       * used to be replayable forever by anyone holding the nonce - and the
       * nonce is in the QR, in access logs, and in the browser for a month.
       * The legitimate client is polling every few seconds and takes it on the
       * first poll after verification; a later poll learns only that the
       * challenge is verified.
       */
      if (!challenge.sessionId) return reply.send({ ok: true, verified: true, address: challenge.user.address, displayName: challenge.user.displayName });
      const took = await prisma.authChallenge.updateMany({
        where: { id: challenge.id, sessionId: { not: null } }, data: { sessionId: null },
      });
      if (took.count === 1) {
        return reply.send({ ok: true, verified: true, sessionId: challenge.sessionId, address: challenge.user.address, displayName: challenge.user.displayName });
      }
      return reply.send({ ok: true, verified: true, address: challenge.user.address, displayName: challenge.user.displayName });
    }

    // Scan for the payment BEFORE enforcing expiry - a payment that lands just
    // past the display TTL is still honored here (and the reconciler catches the
    // rest). `status: 'expired'` is only returned when there's genuinely nothing.
    const expired = new Date() > challenge.expiresAt;

    // ── Shielded flow: watch for the funding memo, then send the code back ──
    if (challenge.kind === 'shielded') {
      const r = await processShieldedFunding(walletNet, challenge, undefined, server.log.warn.bind(server.log));
      /*
       * What the payer can actually watch: seen, then confirmations, then the
       * code. Without it the modal sat on "waiting" from broadcast until the
       * code landed, which is a minute or more of a screen that looks stuck.
       */
      const progress = await fundingProgress(walletNet, challenge);
      const payment = {
        seen: progress.seen, txid: progress.txid,
        confirmations: progress.confirmations, confirmationsNeeded: progress.needed,
      };
      if (r === 'code_sent') return reply.send({ ok: true, verified: false, status: 'code_sent', payment });
      if (r === 'pending') return reply.send({ ok: true, verified: false, status: 'pending', payment });
      // not_funded
      return reply.send({ ok: true, verified: false, status: expired && !progress.seen ? 'expired' : 'pending', payment });
    }

    // ── Transparent flow: amount match + sender check ────────────────────────
    try {
      const utxos = await getAddressUtxos([challenge.toAddress]);
      const match = utxos.find((u) => u.valueZat === challenge.valueZat);
      if (match) {
        const txidHex = txidBufferToHex(match.txid);
        let senders = await getSenderAddresses(txidHex);
        if (senders === null) {
          // Byte-order fallback: some sources return txids already in display order
          senders = await getSenderAddresses(Buffer.from(match.txid).toString('hex'));
        }
        if (senders === null) {
          server.log.warn({ txid: txidHex }, 'Sender resolution failed - withholding verification');
          return reply.send({ ok: true, verified: false, status: 'pending' });
        }
        if (!senders.has(challenge.user.address)) {
          server.log.warn({ txid: txidHex, claimed: challenge.user.address }, 'Challenge paid from a different address - rejected');
          return reply.status(409).send({
            error: 'Payment received, but not from the address being verified. Send from the claimed address.',
            verified: false,
          });
        }
        await prisma.authChallenge.update({ where: { id: challenge.id }, data: { fundedTxid: txidHex } });
        const { session, signedOutOthers } = await issueVerifiedSession(challenge.userId, challenge.id);
        return reply.send({ ok: true, verified: true, sessionId: session.token, address: challenge.user.address, displayName: challenge.user.displayName, signedOutOthers });
      }
    } catch (e) {
      server.log.warn({ err: e }, 'Zaino UTXO query failed');
    }
    return reply.send({ ok: true, verified: false, status: expired ? 'expired' : 'pending' });
  });

  server.post<{ Body: { nonce: string; code: string } }>('/verify-code', async (req, reply) => {
    const walletNet = netOf(req);
    const { nonce, code } = req.body ?? {};
    if (!nonce || !code) return reply.status(400).send({ error: 'nonce and code required' });
    // Per nonce AND per caller, before touching the database: a burst of
    // guesses at one code is the whole attack.
    if (codeLimiter.hit(`n:${nonce}`) || codeLimiter.hit(`ip:${clientIp(req)}`))
      return reply.status(429).send({ error: 'Too many attempts - slow down' });

    const challenge = await prisma.authChallenge.findUnique({ where: { network_nonce: { network: walletNet, nonce } }, include: { user: true } });
    // A link challenge is not a login: it must never be able to mint a session.
    if (!challenge || challenge.linkAddress) return reply.status(404).send({ error: 'Challenge not found' });
    if (new Date() > challenge.expiresAt) return reply.status(410).send({ error: 'Challenge expired' });
    if (challenge.kind !== 'shielded' || challenge.status !== 'code_sent')
      return reply.status(409).send({ error: 'Challenge is not awaiting a code' });

    const judged = await spendCodeAttempt(challenge, code);
    if (!judged.ok) return reply.status(judged.status).send({ error: judged.error });

    const { session, signedOutOthers } = await issueVerifiedSession(challenge.userId, challenge.id);
    return reply.send({ ok: true, verified: true, sessionId: session.token, address: challenge.user.address, displayName: challenge.user.displayName, signedOutOthers });
  });

  // Live display-name availability. `address` lets a user keep their own name.
  server.get<{ Querystring: { name?: string; address?: string } }>('/name-check', async (req, reply) => {
    const name = (req.query?.name ?? '').trim();
    if (!name) return reply.send({ available: false });
    const holder = await prisma.user.findUnique({ where: { nameKey: name.toLowerCase() } });
    const requester = (req.query?.address ?? '').trim();
    return reply.send({ available: !holder || (requester !== '' && holder.address === requester) });
  });

  // ── Password login: verified accounts skip the dust challenge on new devices ──
  // Identified by verified address OR unique display name.
  server.post<{ Body: { address?: string; name?: string; password: string } }>('/login', async (req, reply) => {
    const { address, name, password } = req.body ?? {};
    if ((!address?.trim() && !name?.trim()) || !password)
      return reply.status(400).send({ error: 'display name (or address) and password required' });
    const waitFor = rateLimited(clientIp(req) || req.ip, 'login');
    if (waitFor)
      return reply.status(429).send({
        error: `Too many sign-in attempts from this connection - try again ${waitText(waitFor)}.`,
        retryInSeconds: waitFor,
      });

    // Any address this account has proven, not only the one it was made from.
    const user = address?.trim()
      ? await findUserByAddress(address)
      : await prisma.user.findUnique({ where: { nameKey: name!.trim().toLowerCase() } });
    if (!user || !user.isVerified)
      return reply.status(401).send({ error: 'No verified account found - verify ownership first' });
    if (!user.passwordHash)
      return reply.status(409).send({ error: 'No password set for this account - verify ownership, then set one in Account' });
    if (!verifyPassword(password, user.passwordHash))
      return reply.status(401).send({ error: 'Incorrect password' });
    if (user.frozen === 'all')
      return reply.status(403).send({ error: 'Account frozen by the sysop.' });

    const session = await prisma.userSession.create({ data: { userId: user.id, token: newSessionToken(), expiresAt: sessionExpiry() } });
    const signedOutOthers = await revokeOtherSessions(user.id, session.token);
    return reply.send({ ok: true, verified: true, sessionId: session.token, address: user.address, displayName: user.displayName, signedOutOthers });
  });

  // Set or change the password. Requires a live verified session. Changing an
  // existing password requires the current one - unless this session came from
  // a fresh ownership verification, which outranks a password (= forgot-password
  // reset: re-verify with your address, then set a new password).
  server.post<{ Body: { currentPassword?: string; newPassword: string } }>('/password', async (req, reply) => {
    const authHdr = req.headers.authorization;
    const token = authHdr?.startsWith('Bearer ') ? authHdr.slice(7) : null;
    const session = token
      ? await prisma.userSession.findUnique({ where: { token }, include: { user: true } })
      : null;
    if (!session || session.expiresAt < new Date() || !session.user.isVerified)
      return reply.status(401).send({ error: 'Unauthorized' });
    const user = session.user;

    const { currentPassword, newPassword } = req.body ?? {};
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH)
      return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    if (user.passwordHash && session.via !== 'challenge' && !verifyPassword(currentPassword ?? '', user.passwordHash))
      return reply.status(401).send({ error: 'Current password is incorrect' });

    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } });
    return reply.send({ ok: true });
  });

  // ── Link a testnet address to an account that already exists ──────────────
  /*
   * Accounts are only ever created from a mainnet address. A verified account
   * can then PROVE it controls a testnet address and attach it, so that on a
   * testnet deployment it cuts and buys as itself - proven address, verified
   * rate - instead of naming an address on guest terms.
   *
   * Deliberately separate from /challenge and /verify-code:
   *  - /challenge creates accounts and must never be able to attach anything to
   *    an existing one; it is unauthenticated.
   *  - Success here issues NO session. The caller already has one, and a link
   *    challenge that could mint a session would let whoever controls the
   *    testnet address sign in as the account. The login routes refuse link
   *    challenges outright for the same reason.
   *  - The network is fixed to testnet rather than read from the request, so
   *    nothing about the proxy's network header can move a link onto mainnet.
   *
   * Shielded only. The proof is a code sent as a memo to the address and typed
   * back, which shows you can read that address's memos. The transparent proof
   * needs a per-network receiving t-address and chain indexer that only exist
   * for mainnet.
   */
  const LINK_NET: BackendNetwork = 'testnet';
  const linkReady = (net: BackendNetwork = LINK_NET) => allowedNetworks().includes(net) && walletConfigured(net);

  /*
   * Which chain an "add an address" request is for.
   *
   * /link-testnet is pinned to testnet, exactly as it always was, so nothing
   * that already calls it changes. /link-address takes the network the app is
   * on, which is what lets an account prove a SECOND mainnet address - the
   * thing that stops a fresh unified address from the same wallet being a
   * stranger. Same proof, same routes, one flag apart.
   */
  const linkNet = (req: FastifyRequest, anyNet: boolean): BackendNetwork => (anyNet ? netOf(req) : LINK_NET);

  const startLink = (anyNet: boolean) => async (req: FastifyRequest<{ Body: { address?: string } }>, reply: FastifyReply) => {
    const net = linkNet(req, anyNet);
    const user = await getUser(req);
    if (!user || user.frozen) return reply.status(401).send({ error: 'Unauthorized' });
    if (!linkReady(net)) return reply.status(501).send({ error: `${net} is not enabled on this deployment` });

    const address = String(req.body?.address ?? '').trim();
    const shieldedShape = net === 'testnet' ? /^(utest1|ztestsapling1)/i : /^(u1|zs1)/i;
    if (!shieldedShape.test(address) || !looksLikeAddress(address, net))
      return reply.status(400).send({
        error: net === 'testnet'
          ? 'Link a shielded testnet address (utest1... or ztestsapling1...). The proof is a code sent to it as a memo, which a transparent address cannot receive.'
          : 'Add a shielded address (u1... or zs1...). The proof is a code sent to it as a memo, which a transparent address cannot receive.',
      });
    if (net === 'testnet' && user.testnetAddress === address) return reply.send({ ok: true, linked: true, testnetAddress: address });
    if (user.address === address) return reply.send({ ok: true, linked: true, address });
    const waitFor = rateLimited(clientIp(req) || req.ip, 'challenge');
    if (waitFor)
      return reply.status(429).send({
        error: `Too many verification attempts from this connection - try again ${waitText(waitFor)}.`,
        retryInSeconds: waitFor,
      });

    const toAddress = backendZaddr(net);
    if (!toAddress) return reply.status(503).send({ error: 'Payment receiving address not configured' });

    /*
     * Resume rather than mint, exactly as /challenge does: a funded one first,
     * then an unpaid one that has not expired. Without the second case, three
     * clicks filled the open-challenge cap and the fourth was refused.
     */
    const mine = { network: net, userId: user.id, linkAddress: address };
    const paid = await prisma.authChallenge.findFirst({
      where: { ...mine, status: { in: ['funded', 'code_sent'] } },
      orderBy: { createdAt: 'desc' },
    })
      ?? await prisma.authChallenge.findFirst({
        where: { ...mine, status: 'pending', verified: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
    if (paid) {
      return reply.send({
        nonce: paid.nonce, valueZat: paid.valueZat, valueZEC: (paid.valueZat / 100_000_000).toFixed(8),
        toAddress: paid.toAddress, zip321: paid.zip321, memoText: `zec-os-auth-${paid.nonce}`,
        expiresAt: paid.expiresAt.getTime(), resumed: true, status: paid.status,
      });
    }
    if (await tooManyOpenChallenges(net, user.id))
      return reply.status(429).send({ error: 'Too many open verifications - finish or wait for one to expire' });

    const nonce = generateNonce();
    const valueZat = uniqueValueZat();
    const valueZEC = (valueZat / 100_000_000).toFixed(8);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const memoText = `zec-os-auth-${nonce}`;
    const zip321 = `zcash:${toAddress}?amount=${valueZEC}&memo=${Buffer.from(memoText, 'utf8').toString('base64url')}`;
    await prisma.authChallenge.create({
      data: { network: net, nonce, userId: user.id, kind: 'shielded', valueZat, toAddress, zip321, expiresAt, linkAddress: address },
    });
    return reply.send({ nonce, valueZat, valueZEC, toAddress, zip321, memoText, expiresAt: expiresAt.getTime() });
  };
  server.post<{ Body: { address?: string } }>('/link-testnet', startLink(false));
  server.post<{ Body: { address?: string } }>('/link-address', startLink(true));

  /** Only the account that opened a link challenge may watch or finish it. */
  const ownedLink = async (userId: string, nonce: string, net: BackendNetwork) => {
    const c = await prisma.authChallenge.findUnique({
      where: { network_nonce: { network: net, nonce } }, include: { user: true },
    });
    return c && c.linkAddress && c.userId === userId ? c : null;
  };

  const pollLink = (anyNet: boolean) => async (req: FastifyRequest<{ Params: { nonce: string } }>, reply: FastifyReply) => {
    const net = linkNet(req, anyNet);
    const user = await getUser(req);
    if (!user || user.frozen) return reply.status(401).send({ error: 'Unauthorized' });
    const challenge = await ownedLink(user.id, req.params.nonce, net);
    if (!challenge) return reply.status(404).send({ error: 'Challenge not found' });
    if (challenge.status === 'verified') {
      return reply.send({ ok: true, status: 'linked', address: challenge.linkAddress, testnetAddress: challenge.linkAddress });
    }
    const r = await processShieldedFunding(net, challenge, undefined, server.log.warn.bind(server.log));
    if (r === 'code_sent' || r === 'pending') return reply.send({ ok: true, status: r });
    return reply.send({ ok: true, status: new Date() > challenge.expiresAt ? 'expired' : 'pending' });
  };
  server.get<{ Params: { nonce: string } }>('/link-testnet/:nonce', pollLink(false));
  server.get<{ Params: { nonce: string } }>('/link-address/:nonce', pollLink(true));

  const finishLink = (anyNet: boolean) => async (req: FastifyRequest<{ Body: { nonce?: string; code?: string } }>, reply: FastifyReply) => {
    const net = linkNet(req, anyNet);
    const user = await getUser(req);
    if (!user || user.frozen) return reply.status(401).send({ error: 'Unauthorized' });
    const { nonce, code } = req.body ?? {};
    if (!nonce || !code) return reply.status(400).send({ error: 'nonce and code required' });
    if (codeLimiter.hit(`n:${nonce}`) || codeLimiter.hit(`ip:${clientIp(req)}`))
      return reply.status(429).send({ error: 'Too many attempts - slow down' });

    const challenge = await ownedLink(user.id, nonce, net);
    if (!challenge) return reply.status(404).send({ error: 'Challenge not found' });
    if (new Date() > challenge.expiresAt) return reply.status(410).send({ error: 'Challenge expired' });
    if (challenge.status !== 'code_sent') return reply.status(409).send({ error: 'Challenge is not awaiting a code' });

    const judged = await spendCodeAttempt(challenge, code);
    if (!judged.ok) return reply.status(judged.status).send({ error: judged.error });

    const address = challenge.linkAddress!;
    /*
     * The last successful proof wins. If another account had linked this
     * address, it is released from that account in the same transaction.
     *
     * Refusing instead would mean answering "is this address linked to someone"
     * before any proof - a confirmation oracle. Releasing only AFTER proof leaks
     * nothing: the caller has just shown they control the address. Pools that
     * account already owns are untouched, since ownership is held by account,
     * not by address.
     */
    await prisma.$transaction([
      /* The testnet COLUMN is what prices and caps a testnet acquisition, so a
         testnet proof still writes it. A mainnet alternate is an identity, not
         a new allowance: it goes in the table only, and `User.address` keeps
         driving the per-address cap. */
      ...(net === 'testnet' ? [
        prisma.user.updateMany({ where: { testnetAddress: address, id: { not: user.id } }, data: { testnetAddress: null } }),
        prisma.user.update({ where: { id: user.id }, data: { testnetAddress: address } }),
      ] : []),
      // The proven-address table follows the same rule as the column above:
      // the last successful proof wins, so a row held by another account is
      // released here rather than blocking the write below.
      prisma.userAddress.deleteMany({ where: { address, userId: { not: user.id } } }),
    ]);
    // Recorded as a proven address too, so one list answers "what is mine".
    await addProvenAddress(user.id, address, net);
    await prisma.authChallenge.update({ where: { id: challenge.id }, data: { verified: true, status: 'verified' } });
    return reply.send({ ok: true, linked: true, address, ...(net === 'testnet' ? { testnetAddress: address } : {}) });
  };
  server.post<{ Body: { nonce?: string; code?: string } }>('/link-testnet/verify-code', finishLink(false));
  server.post<{ Body: { nonce?: string; code?: string } }>('/link-address/verify-code', finishLink(true));

  server.get('/zaino-status', async (_req, reply) => {
    try {
      const [info, block] = await Promise.all([getLightdInfo(), getLatestBlock()]);
      // Active node reflects whichever full node Zaino is connected to. ACTIVE_NODE
      // env pins it manually when the subversion string is ambiguous.
      const override = process.env.ACTIVE_NODE?.toLowerCase();
      const node = (override === 'zebra' || override === 'zakura' || override === 'zcashd')
        ? override
        : nodeFromSubversion(info.zcashdSubversion, info.vendor);
      return reply.send({
        ok: true,
        chain: info.chainName,
        blockHeight: block.height,
        node,
        subversion: info.zcashdSubversion || info.vendor || '',
      });
    } catch (e: any) {
      return reply.status(503).send({ ok: false, error: e?.message ?? 'Zaino unreachable' });
    }
  });
}
