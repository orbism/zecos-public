// System wallet adapter - the read/send surface the auth, contest, rpg and
// payout routes use. Backed by Zallet (see ./zallet.ts for the transport).
//
// Used for the shielded ownership-verification flow:
//   - reading incoming memos at BACKEND_ZADDR (z_listtransactions)
//   - sending the code memo back to the claimed address (z_sendmany, via anchor)
//
// WHY ZALLET AND NOT ZINGO
// This module used to drive zingo-cli by exec. That stopped working when NU6.3
// (Ironwood) activated at block 3428143 on 2026-07-28: the pinned zingolib
// (0ed92148, 2026-06-17) cannot parse a v6 transaction, so every sync aborted
// with "invalid consensus branch id 0x37a5165b" and the wallet froze at block
// 3403166. Reads kept succeeding and kept returning pre-NU6.3 data, so the
// backend saw no incoming memos and users who paid were never credited - for
// five weeks, with nothing failing loudly. Upstream Ironwood support was still
// unmerged (zingolib#2420), so there was no version to upgrade to.
//
// The seed was recovered into Zallet, which scans post-Ironwood correctly, and
// BACKEND_ZADDR is unchanged: it is account 0 / diversifier 0 / orchard-only, so
// Zallet re-derives the identical unified address and every payment URI already
// in the wild stays valid. The zingo container and its wallet file remain as an
// offline fallback holding the same seed; nothing here talks to them.
//
// The stale-read failure is why walletSyncLag() exists and why callers must not
// read "no memo found" as "not paid" without checking it.

import {
  accountForAddress,
  anchor,
  backendNetwork,
  getWalletStatus,
  listAccountTransactions,
  NotSentError,
  walletTargetFor,
  type BackendNetwork,
  type ZalletPrivacyPolicy,
} from './zallet';

/**
 * Every function here takes the network EXPLICITLY.
 *
 * One instance now serves both chains, chosen per request, so there is no such
 * thing as "the" network at module scope. The default exists only for code with
 * no request to inherit from - and `backendNetwork()` itself defaults to
 * mainnet, so a missing network is always the conservative reading and never
 * silently reaches for the testnet wallet.
 *
 * Two invariants must survive every call site:
 *   - backendZaddr throws when the address prefix does not match the network,
 *     so an invoice is never minted at an address that wallet cannot be paid at
 *   - walletConfigured takes the passphrase and the address from the SAME
 *     network row, so the two can never disagree
 */
export type { BackendNetwork } from './zallet';
import { createHash } from 'crypto';

export interface ReceivedNote {
  txid: string;
  /** "<pool>:<output_index>", which output of the transaction this is; absent if the wallet did not say. */
  noteRef?: string;
  amount: number;      // ZEC
  amountZat?: number;
  memo: string;        // plaintext (zallet decodes text memos already)
  confirmations: number;
}

export function walletConfigured(net: BackendNetwork = backendNetwork()): boolean {
  // The passphrase is required, not optional: without it reads still work but
  // the code memo can never be sent, which would strand every payer at
  // "funded" with no way forward. Better to report the flow as unavailable.
  //
  // Both halves come from the SAME network's row, so a testnet backend cannot end up
  // reading a mainnet address with a testnet passphrase, or vice versa - which would
  // mint invoices at an address this wallet cannot see paid.
  const target = walletTargetFor(net);
  if (!process.env[target.passphraseEnv]) return false;
  try {
    // Via backendZaddr so a network/address mismatch reports "not configured" here
    // rather than passing this check and throwing later, at the point of issuing an
    // invoice. The two must not be able to disagree.
    return backendZaddr(net).length > 0;
  } catch {
    return false;
  }
}

/**
 * Can this address receive a memo?
 *
 * Zallet treats a memo on a TRANSPARENT recipient as an explicit error, not a
 * silently-dropped field - so anything attaching a memo has to know. Accounts
 * here verify with either a shielded or a transparent address, so the recipient
 * genuinely may be either.
 *
 * Prefix matching rather than a decode call: it needs no RPC, cannot fail
 * closed on a wallet hiccup, and the HRPs are consensus constants.
 */
export function canReceiveMemo(address: string): boolean {
  const a = address.trim().toLowerCase();
  return (
    a.startsWith('u1') ||             // unified, mainnet
    a.startsWith('utest1') ||         // unified, testnet
    a.startsWith('zs1') ||            // sapling, mainnet
    a.startsWith('ztestsapling1')     // sapling, testnet
  );
}

// Unified address HRPs: "u" on mainnet, "utest" on testnet (ZIP 316).
const UA_PREFIX: Record<'mainnet' | 'testnet', string> = { mainnet: 'u1', testnet: 'utest1' };

export function backendZaddr(net: BackendNetwork = backendNetwork()): string {
  const network = net;
  const target = walletTargetFor(net);
  const address = process.env[target.zaddrEnv] || '';
  if (address.length === 0) return '';

  // The failure this prevents: BACKEND_NETWORK=testnet with a mainnet u1... address
  // still parses, still renders a payment URI, and still gets handed to users - but
  // the testnet wallet does not hold it and the testnet chain can never settle it, so
  // every payer is stranded at "funded" exactly as they were during the Zingo stall.
  // Refuse at the source rather than mint an invoice nothing can pay.
  const expected = UA_PREFIX[network];
  if (!address.startsWith(expected)) {
    throw new Error(
      `${target.zaddrEnv} is not a ${network} unified address (expected "${expected}...", ` +
      `got "${address.slice(0, 6)}...") - refusing to issue invoices this wallet cannot be paid at`,
    );
  }
  return address;
}

/** Which chain the payment flow is operating on. Surfaced so callers can label URIs. */
export function walletNetwork(net: BackendNetwork = backendNetwork()): 'mainnet' | 'testnet' {
  return net;
}

// A shielded send that crosses pools cannot be FullPrivacy, and after NU6.3 the
// wallet holds both orchard and ironwood notes while recipients advertise
// whichever receivers their wallet supports - so a dust reply routinely has to
// move value between shielded pools. AllowRevealedAmounts permits exactly that
// and nothing more: it still refuses a transparent leg, so the send stays fully
// shielded. FullPrivacy here would fail whenever the note pool and the
// recipient's best receiver disagree.
const SEND_PRIVACY_POLICY: ZalletPrivacyPolicy = 'AllowRevealedAmounts';

/**
 * A transparent recipient (t1/t3, testnet tm/t2) needs one step more:
 * AllowRevealedRecipients, which Zallet requires to pay a t-address at all and
 * which still allows what AllowRevealedAmounts does. Senders are never
 * revealed: the wallet still spends only shielded notes. Under the shielded-only
 * policy every payout and refund to a t-address failed and retried forever
 * (audit 2).
 */
// t1/t3 mainnet, tm/t2/tn/tr testnet, and TEX (ZIP 320) addresses, which are transparent-only.
const isTransparent = (address: string) => /^(t1|t3|tm|t2|tn|tr|tex1|textest1)/i.test(address.trim());
export function policyFor(addresses: string[]): ZalletPrivacyPolicy {
  return addresses.some(isTransparent) ? 'AllowRevealedRecipients' : SEND_PRIVACY_POLICY;
}

// ── Account resolution ───────────────────────────────────────────────────────
// Resolved by matching BACKEND_ZADDR against the wallet's own account list
// rather than configured as a uuid. That makes the address the single source of
// truth: a wallet that does not actually hold BACKEND_ZADDR fails loudly here
// instead of quietly reconciling against, or spending from, some other account.
// Cached only on success, since the miss case is a misconfiguration to re-check.
/**
 * Cached per NETWORK, not globally.
 *
 * A single slot keyed by address alone would thrash the moment two chains are
 * served from one instance: every alternating request would evict the other's
 * entry and re-query the wallet.
 */
const cachedAccountUuid = new Map<BackendNetwork, { address: string; uuid: string }>();

async function authAccountUuid(net: BackendNetwork = backendNetwork()): Promise<string> {
  const address = backendZaddr(net);
  const envName = walletTargetFor(net).zaddrEnv;
  if (!address) throw new Error(`${envName} not configured`);
  const hit = cachedAccountUuid.get(net);
  if (hit?.address === address) return hit.uuid;
  const account = await accountForAddress(address, net);
  if (account === null) {
    throw new Error(
      `no zallet account holds ${envName} (${address.slice(0, 16)}...) - refusing to read or ` +
      'spend against a wallet that does not control the advertised address',
    );
  }
  cachedAccountUuid.set(net, { address, uuid: account.accountUuid });
  return account.accountUuid;
}

// ── Sync health ──────────────────────────────────────────────────────────────

/**
 * Blocks the wallet is behind Zebra's tip, or null if that cannot be
 * established (a rescan in progress reports no wallet tip at all).
 *
 * A caller deciding "this challenge was never paid" MUST consult this. The
 * outage this module was rewritten for produced exactly that false negative.
 */
export async function walletSyncLag(net: BackendNetwork = backendNetwork()): Promise<number | null> {
  const status = await getWalletStatus(net);
  if (status.nodeTipHeight === null) return null;
  const scanned = status.fullySyncedHeight ?? status.walletTipHeight;
  if (scanned === null) return null;
  return Math.max(0, status.nodeTipHeight - scanned);
}

// Beyond this, reads are treated as unreliable rather than empty. Two blocks of
// slack absorbs the normal race between Zebra accepting a block and the wallet
// scanning it.
const MAX_TRUSTED_LAG_BLOCKS = Math.max(
  2,
  Number.parseInt(process.env.WALLET_MAX_SYNC_LAG_BLOCKS ?? '', 10) || 8,
);

// Lag as last seen by a payment read, per network. The beacon reports this
// instead of asking the wallet, so a beacon hit never spawns a docker exec.
// `lag: null` means the wallet could not say (rescan in progress).
const lastLag = new Map<BackendNetwork, { lag: number | null; at: number }>();

export function lastKnownWalletLag(net: BackendNetwork = backendNetwork()): { lag: number | null; at: number } | null {
  return lastLag.get(net) ?? null;
}

export function maxTrustedLagBlocks(): number { return MAX_TRUSTED_LAG_BLOCKS; }

/** The height this network's wallet had scanned to at the last receive listing, or null. */
const lastScanned = new Map<BackendNetwork, number>();
export function lastScannedHeight(net: BackendNetwork): number | null {
  return lastScanned.get(net) ?? null;
}

// ── Wallet ops ───────────────────────────────────────────────────────────────

/**
 * Incoming notes at BACKEND_ZADDR, newest scan state included.
 *
 * The address argument is kept for interface compatibility and is checked, not
 * ignored: this wallet resolves one account from BACKEND_ZADDR and reading a
 * different address here would silently return the wrong account's memos.
 *
 * THROWS when the wallet is too far behind the chain to be believed. Callers
 * already treat a thrown error as "unknown, retry later" and a returned list as
 * authoritative, so failing loudly is what stops a stalled scan from being read
 * as "nobody paid".
 */
/*
 * ONE READ OF THE WALLET, SHARED (audit H2/H3).
 *
 * Every payment check - each cut, buy and send poll, three reconcilers, the
 * payers - used to run its own z_listtransactions, so one reconcile pass over
 * N open orders read the whole history N times. Now concurrent and back-to-back
 * callers share one read per network for VIEW_TTL_MS.
 *
 * And the read is bounded: only the last DETECTION_WINDOW_BLOCKS blocks
 * (default 12,000, about ten days - longer than the 7-day reconcile window).
 * Read from the account's birthday, the history eventually outgrew the RPC
 * output buffer and detection failed for good. 0 reads the full history.
 */
const WINDOW_BLOCKS = Math.max(0, parseInt(process.env.DETECTION_WINDOW_BLOCKS ?? '12000', 10) || 0);
const VIEW_TTL_MS = 10_000;
interface WalletView { uuid: string; nodeTip: number | null; scanned: number | null; txs: Awaited<ReturnType<typeof listAccountTransactions>> }
const views = new Map<string, { at: number; p: Promise<WalletView> }>();
function walletView(net: BackendNetwork, fullHistory = false): Promise<WalletView> {
  const key = `${net}|${fullHistory}`;
  const hit = views.get(key);
  if (hit && Date.now() - hit.at < VIEW_TTL_MS) return hit.p;
  const p = (async () => {
    const uuid = await authAccountUuid(net);
    const status = await getWalletStatus(net);
    const scanned = status.fullySyncedHeight ?? status.walletTipHeight;
    const start = !fullHistory && WINDOW_BLOCKS > 0 && status.nodeTipHeight !== null
      ? Math.max(0, status.nodeTipHeight - WINDOW_BLOCKS) : undefined;
    const txs = await listAccountTransactions(uuid, net, start);
    return { uuid, nodeTip: status.nodeTipHeight, scanned, txs };
  })();
  views.set(key, { at: Date.now(), p });
  p.catch(() => { if (views.get(key)?.p === p) views.delete(key); });
  return p;
}

export async function zListReceivedByAddress(
  address: string,
  minConf = 1,
  net: BackendNetwork = backendNetwork(),
  /** fullHistory: read from the account's birthday - for rare operator tools only. */
  opts: { includeSelfSends?: boolean; fullHistory?: boolean } = {},
): Promise<ReceivedNote[]> {
  const expected = backendZaddr(net);
  if (address && expected && address !== expected) {
    // Names the network so the message is actionable: this fires when a caller
    // asks about one chain's receiving address while the wallet is on the other.
    throw new Error(
      `zListReceivedByAddress: address does not match the ${net} backend address `
      + `(${walletTargetFor(net).zaddrEnv})`,
    );
  }
  const view = await walletView(net, opts.fullHistory);
  const { uuid, scanned } = view;
  const status = { nodeTipHeight: view.nodeTip };
  if (status.nodeTipHeight === null || scanned === null) {
    lastLag.set(net, { lag: null, at: Date.now() });
    throw new Error('wallet scan state unavailable (rescan in progress?) - cannot trust an empty result');
  }
  const lag = status.nodeTipHeight - scanned;
  lastLag.set(net, { lag, at: Date.now() });
  lastScanned.set(net, scanned);
  if (lag > MAX_TRUSTED_LAG_BLOCKS) {
    throw new Error(
      `wallet is ${lag} blocks behind the chain tip (${scanned} vs ${status.nodeTipHeight}) - ` +
      'refusing to report incoming memos from a stale scan',
    );
  }

  const { txs } = view;
  const notes: ReceivedNote[] = [];
  for (const tx of txs) {
    // An expired, never-mined transaction paid nothing; not even a sighting.
    if (tx.expiredUnmined) continue;
    // Unmined transactions have no height; count them as zero-confirmation
    // rather than dropping them, so minConf=0 callers can still see them.
    const confirmations = tx.minedHeight === null ? 0 : Math.max(0, status.nodeTipHeight - tx.minedHeight + 1);
    if (confirmations < minConf) continue;
    for (const out of tx.outputs) {
      if (out.toAccount !== uuid) continue;
      /*
       * Zallet flags a payment made FROM this same account as change
       * (is_change=true, reproduced on testnet 2026-09-28, audit M4), so with
       * includeSelfSends such a payment was still dropped. Real change carries
       * no order nonce, and detection matches on the nonce, so letting flagged
       * self-sends through here is safe.
       */
      if (out.isChange && !(opts.includeSelfSends && out.fromAccount !== null)) continue;
      /*
       * Normally we ignore anything this wallet sent itself, or the dust replies
       * the backend emits would be re-read as incoming funding.
       *
       * `includeSelfSends` is for payment detection, where that rule is wrong.
       * On testnet the only funded wallet IS this one, so paying an invoice from
       * Zallet makes the payment a self-send and it was being discarded before
       * its memo was ever looked at - the payment arrived and the poll never saw
       * it. The same is true of anyone on mainnet who happens to pay from an
       * address this wallet holds.
       *
       * Letting them through is safe because the caller does not match on
       * origin: it matches on a 12-byte random nonce carried in the memo, and no
       * memo this backend sends carries a pending order's nonce.
       */
      if (out.fromAccount !== null && !opts.includeSelfSends) continue;
      notes.push({
        txid: tx.txid,
        ...(out.outputIndex !== null && out.pool ? { noteRef: `${out.pool}:${out.outputIndex}` } : {}),
        amountZat: out.valueZat,
        amount: out.valueZat / 100_000_000,
        memo: out.memo ?? '',
        confirmations,
      });
    }
  }
  return notes;
}

/**
 * Sends each recipient its own transaction and returns the txids.
 *
 * Must yield a txid per recipient. anchor() resolves only once the operation
 * reaches a terminal state, but a timeout or a Zallet restart can leave it
 * unfinished - and a missing txid means the memo may not have gone out, so this
 * throws rather than letting a caller record the code as delivered.
 */
export async function zSendMany(
  fromAddress: string,
  recipients: Array<{ address: string; amount: number; memo?: string }>,
  net: BackendNetwork = backendNetwork(),
  opts: {
    /**
     * Replay key. Default is a hash of the payload, which is right for memo
     * sends (same code = same send). A PAYOUT must key on the DEBT instead:
     * two different debts of the same amount to the same address are two
     * sends, and a payload key would silently collapse them into one.
     */
    idempotencyKey?: string;
    /** 'payout' selects the payout spend cap. Default 'dust'. */
    purpose?: 'dust' | 'payout';
    /** Told each Zallet operation id as soon as it is accepted (see AnchorRequest.onOperation). */
    onOperation?: (operationId: string) => Promise<void>;
    /** Asked when the lane runs the send; false refuses it as not sent (see AnchorRequest.precheck). */
    precheck?: () => Promise<boolean>;
  } = {},
): Promise<string> {
  const from = fromAddress || backendZaddr();
  if (!from) throw new NotSentError('zSendMany: no from address');
  const txids: string[] = [];
  for (const [i, r] of recipients.entries()) {
    const amountZat = Math.round(r.amount * 100_000_000);
    const memoHex = r.memo === undefined ? undefined : Buffer.from(r.memo, 'utf8').toString('hex');
    // Keyed on the exact payload: the memo carries a single-use verification
    // code, so an identical send is always a retry of the same one and must
    // resolve to the original operation instead of paying twice.
    const idempotencyKey = opts.idempotencyKey
      ? (recipients.length === 1 ? opts.idempotencyKey : `${opts.idempotencyKey}:${i}`)
      : createHash('sha256').update(`${from}|${r.address}|${amountZat}|${memoHex ?? ''}`).digest('hex');
    // The network reaches the wallet here. Without it every shielded send -
    // auth codes, receipts, payouts, the registry log, anchors - went out from
    // the mainnet wallet whatever network was asked for.
    const result = await anchor({
      fromAddress: from,
      recipients: [{ address: r.address, amountZat, memoHex }],
      idempotencyKey,
      purpose: opts.purpose,
      privacyPolicy: policyFor([r.address]),
      onOperation: opts.onOperation,
      precheck: opts.precheck,
    }, net);
    if (result.txid === null) {
      throw new Error(
        `send did not produce a txid - state=${result.state ?? 'unknown'} ` +
        `operation=${result.operationId}${result.error === null ? '' : ` error=${result.error}`}`,
      );
    }
    txids.push(result.txid);
  }
  return txids.join(',');
}

/**
 * One transaction, one output per recipient, one txid.
 *
 * The counterpart to zSendMany above, which deliberately sends a transaction
 * EACH. Use this where several people are owed the same kind of note at the
 * same moment - receipts for a settled batch - because ten outputs cost about
 * twice one send on the lane rather than ten times (measured on the box,
 * 2026-09-16).
 *
 * ADDRESSES MUST BE DISTINCT. Zallet refuses a duplicate recipient before it
 * builds anything ("Invalid parameter, duplicated recipient address", code -8),
 * so two notes for one address are two sends, or one note whose memo names
 * both. Checked here rather than at the RPC, so the caller gets a message that
 * says what to do about it.
 *
 * The total must fit the purpose's spend cap - see anchorCapZat() - so a caller
 * batching many outputs sizes the batch to the cap instead of being refused.
 */
export async function zSendManyBatch(
  fromAddress: string,
  recipients: Array<{ address: string; amount: number; memo?: string }>,
  net: BackendNetwork = backendNetwork(),
  opts: { idempotencyKey?: string; purpose?: 'dust' | 'payout' } = {},
): Promise<string> {
  const from = fromAddress || backendZaddr();
  if (!from) throw new Error('zSendManyBatch: no from address');
  if (recipients.length === 0) throw new Error('zSendManyBatch: no recipients');
  const seen = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r.address)) throw new Error('zSendManyBatch: one output per address - Zallet refuses duplicates');
    seen.add(r.address);
  }
  const outs = recipients.map((r) => ({
    address: r.address,
    amountZat: Math.round(r.amount * 100_000_000),
    memoHex: r.memo === undefined ? undefined : Buffer.from(r.memo, 'utf8').toString('hex'),
  }));
  const idempotencyKey = opts.idempotencyKey ?? createHash('sha256')
    .update(`${from}|${outs.map((o) => `${o.address}:${o.amountZat}:${o.memoHex ?? ''}`).join('|')}`)
    .digest('hex');
  const result = await anchor({
    fromAddress: from, recipients: outs, idempotencyKey,
    purpose: opts.purpose, privacyPolicy: policyFor(outs.map((o) => o.address)),
  }, net);
  if (result.txid === null) {
    throw new Error(
      `batch send did not produce a txid - state=${result.state ?? 'unknown'} `
      + `operation=${result.operationId}${result.error === null ? '' : ` error=${result.error}`}`,
    );
  }
  return result.txid;
}

/**
 * Zallet returns text memos already decoded, so this is a passthrough for them.
 * The hex branch stays because it is still correct for a memo that arrives as
 * hex, and because every caller pipes wallet memos through here.
 */
export function decodeMemoHex(memo: string): string {
  if (/^[0-9a-fA-F]+$/.test(memo) && memo.length % 2 === 0) {
    try {
      const buf = Buffer.from(memo, 'hex');
      let end = buf.length;
      while (end > 0 && buf[end - 1] === 0) end--;
      return buf.subarray(0, end).toString('utf8');
    } catch { /* fall through */ }
  }
  return memo;
}

/**
 * Is this a Zcash address of any kind, for this network?
 *
 * Prefix matching only, for the same reasons as `canReceiveMemo`: no RPC, no
 * failure mode when the wallet is busy, and the HRPs are consensus constants.
 * It says the string is SHAPED like an address, not that it is spendable - the
 * only thing we need before using one as a delivery target and a cap key.
 */
export function looksLikeAddress(address: string, net: BackendNetwork = backendNetwork()): boolean {
  const a = address.trim().toLowerCase();
  if (a.length < 20 || a.length > 512) return false;
  const mainnet = ['u1', 'zs1', 't1', 't3'];
  // t2: testnet P2SH (multisig), the testnet twin of mainnet t3.
  const testnet = ['utest1', 'ztestsapling1', 'tm', 't2', 'tn', 'tr'];
  return (net === 'testnet' ? testnet : mainnet).some((p) => a.startsWith(p));
}

/**
 * Did this wallet already send `amountZat` to `address`? For settling a send
 * whose outcome is unknown (a timeout, a crash): the wallet's own history is
 * the record that survives both. A memo carrying `ref` identifies it exactly;
 * a transparent recipient has no memo, so address + amount + time decide.
 * Unmined transactions count - they are out.
 */
export async function findOutgoing(
  net: BackendNetwork, address: string, amountZat: number, ref: string, since: Date,
  /** Txids already credited to another debt: one transaction pays one send. */
  exclude: ReadonlySet<string> = new Set(),
): Promise<string | null> {
  const { uuid, txs, nodeTip, scanned } = await walletView(net);
  /*
   * "Not found" only means something if the wallet has scanned to the tip.
   * Behind or rescanning, its history is incomplete, and a miss here would make
   * callers resend (an auth code) or re-pay (an unknown send). So a stale view
   * is an error, never an answer - the same rule zListReceivedByAddress keeps.
   */
  if (nodeTip === null || scanned === null || nodeTip - scanned > MAX_TRUSTED_LAG_BLOCKS) {
    throw new Error(`wallet scan is behind (${scanned ?? '?'} of ${nodeTip ?? '?'}) - cannot say a payment was not sent`);
  }
  const floor = Math.floor(since.getTime() / 1000) - 600;
  for (const tx of txs) {
    // Expired without being mined: it went nowhere, so it is NOT a send.
    if (tx.expiredUnmined || exclude.has(tx.txid)) continue;
    if (tx.blockTime !== null && tx.blockTime < floor) continue;
    for (const out of tx.outputs) {
      // is_change is NOT a filter here: a payout to an address in this same
      // wallet comes back flagged as change (audit M4), and missing it would
      // send it twice. The exact address, amount and ref decide.
      if (out.fromAccount !== uuid || out.toAddress !== address || out.valueZat !== amountZat) continue;
      if (out.memo && !out.memo.includes(ref) && canReceiveMemo(address)) continue;
      return tx.txid;
    }
  }
  return null;
}

/**
 * Sends this wallet made that EXPIRED without being mined, among `txids`, with
 * the address each was going to. A payout marked paid on a successful send can
 * still expire unmined (after a reorg, say) and reach nobody. Only answers
 * from an up-to-date wallet: behind, an absent or unmined tx proves nothing.
 */
export async function expiredSends(net: BackendNetwork, txids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (txids.length === 0) return out;
  const { uuid, txs, nodeTip, scanned } = await walletView(net);
  if (nodeTip === null || scanned === null || nodeTip - scanned > MAX_TRUSTED_LAG_BLOCKS) return out;
  const want = new Set(txids);
  for (const tx of txs) {
    if (!tx.expiredUnmined || !want.has(tx.txid)) continue;
    // Only an output that LEFT this wallet names the recipient; anything back to
    // our own account is change. None found: no address (claim or manual).
    const to = tx.outputs.find((o) => o.fromAccount === uuid && o.toAddress && o.toAccount !== uuid && !o.isChange);
    out.set(tx.txid, to?.toAddress ?? null);
  }
  return out;
}
