// Zallet wallet adapter - capsule provisioning and anchoring, via per-call
// `docker exec zec-zallet zallet --datadir /data rpc <method> [json params]`.
//
// Zallet binds its JSON-RPC to 127.0.0.1:8238 INSIDE the container and publishes
// no port, so exec is the only path from the host. Auth is the datadir cookie,
// which the binary reads for itself on each invocation - nothing here may cache a
// connection or a credential, because the cookie is regenerated on every Zallet
// restart and a cached one would fail closed at the worst possible moment.
//
// Unlike proxy/zallet-rpc-gate, this path is UNRESTRICTED: it can spend. Hence
// the guardrails, all of which are load-bearing:
//   - the exec target must be ZALLET_CONTAINER (see assertZalletTarget)
//   - every send is capped in zatoshi before it reaches the wallet
//   - unlock/spend/relock is serialised through one lane and relocks in `finally`
//   - the passphrase never reaches a log line, an error message or a stack
//
// Method signatures verified against the live binary (`zallet rpc help <method>`
// and `rpc.discover`), zallet-zaino, Aug 2026. Where the help text and the
// OpenRPC schema disagreed, the schema won, since it is what serde enforces.
//
// Capsule provisioning and anchoring are library-only. The reads and anchor()
// are additionally the engine behind ./rpc.ts, which is what the auth, contest,
// rpg and payout routes talk to.

import { recordUpstream } from '../lib/metrics';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────────

export interface ZalletCapsule {
  accountUuid: string;
  /** ZIP 32 account index. Null only for accounts with no derivation info. */
  zip32AccountIndex: number | null;
  address: string;
  diversifierIndex: number | null;
  receiverTypes: string[];
}

export interface ZalletCapsuleAddress {
  address: string;
  diversifierIndex: number | null;
}

export interface ZalletCapsuleAccount {
  accountUuid: string;
  name: string | null;
  zip32AccountIndex: number | null;
  seedfp: string | null;
  addresses: ZalletCapsuleAddress[];
}

export interface ZalletPoolBalance {
  pool: string;
  valueZat: number;
}

export interface ZalletWalletStatus {
  /** Zebra's tip, as the wallet's indexer sees it. */
  nodeTipHeight: number | null;
  /**
   * How far the wallet has scanned. Null while a recovery/rescan is in flight -
   * Zallet omits both wallet_tip and fully_synced_height until the backfill
   * completes, which is itself the signal that a scan is running.
   */
  walletTipHeight: number | null;
  fullySyncedHeight: number | null;
}

export interface ZalletTxOutput {
  pool: string;
  /** Position of the output within its pool in the transaction; (pool, outputIndex) is unique per tx. Null if not reported. */
  outputIndex: number | null;
  /** Null for an account this wallet does not hold (i.e. an outgoing payment). */
  toAccount: string | null;
  /** Null when the funds came from outside this wallet. */
  fromAccount: string | null;
  toAddress: string | null;
  valueZat: number;
  isChange: boolean;
  /**
   * Plaintext, NOT hex: Zallet decodes text memos before returning them
   * (verified against the live binary). Kept as the wallet gave it so callers
   * can still hex-decode a non-text memo themselves.
   */
  memo: string | null;
}

export interface ZalletTransaction {
  txid: string;
  /** Null while unmined. Such a transaction has zero confirmations. */
  minedHeight: number | null;
  blockTime: number | null;
  feePaidZat: number | null;
  /**
   * Zallet's expired_unmined: the transaction passed its expiry height without
   * being mined, so it will never be. It went nowhere - not a payment, in or out.
   */
  expiredUnmined: boolean;
  outputs: ZalletTxOutput[];
}

export interface ZalletCapsuleBalance {
  pools: ZalletPoolBalance[];
  /** Sum over the reported pools. Pools with a zero balance are omitted upstream. */
  totalZat: number;
  minimumConfirmations: number | null;
}

/** z_sendmany's `privacy_policy` argument, exactly as the binary enumerates it. */
export type ZalletPrivacyPolicy =
  | 'FullPrivacy'
  | 'AllowRevealedAmounts'
  | 'AllowRevealedRecipients'
  | 'AllowRevealedSenders'
  | 'AllowFullyTransparent'
  | 'AllowLinkingAccountAddresses'
  | 'NoPrivacy';

/** OperationState in the OpenRPC schema. */
export type ZalletOperationState = 'Ready' | 'Executing' | 'Cancelled' | 'Failed' | 'Success';

export interface ZalletOperation {
  operationId: string;
  /** Null when the wallet no longer knows this id - see waitForAnchor. */
  state: ZalletOperationState | null;
  terminal: boolean;
  txid: string | null;
  error: string | null;
  creationTime: number | null;
  executionSecs: number | null;
}

export interface AnchorRecipient {
  /** taddr, zaddr or UA. A memo is only legal for a shielded recipient. */
  readonly address: string;
  /** Integer zatoshi. Converted to the ZEC decimal the RPC wants without float. */
  readonly amountZat: number;
  readonly memoHex?: string;
}

export interface AnchorRequest {
  /**
   * The capsule's unified address. z_sendmany has no account parameter: given a
   * UA it selects TXOs from that UA's account, which is how a send is bound to
   * one capsule. Use capsuleAddress() to resolve it from an account id.
   */
  readonly fromAddress: string;
  readonly recipients: readonly AnchorRecipient[];
  /**
   * Caller-supplied replay guard. The first send under a key records its
   * operation id; a retry with the same key returns that id instead of paying
   * again. See the idempotency section for what this does NOT cover.
   */
  readonly idempotencyKey: string;
  /**
   * What this send is. 'dust' (default) is a memo carrier - anchors, receipts,
   * codes - and is capped at ZALLET_MAX_ANCHOR_ZATOSHI. 'payout' is money
   * leaving to a person - marketplace proceeds, refunds - and is capped
   * separately at ZALLET_MAX_PAYOUT_ZATOSHI, which defaults to 0: a box that
   * has not opted into paying people out cannot be made to.
   */
  readonly purpose?: 'dust' | 'payout';
  /** Account uuid or ZIP 32 index, for the audit line only. */
  readonly capsule?: string;
  readonly minconf?: number;
  readonly privacyPolicy?: ZalletPrivacyPolicy;
  /** How long to wait for a terminal operation state. Also sizes the unlock window. */
  readonly waitMs?: number;
  /**
   * Called with the operation id the moment Zallet accepts the send, before
   * waiting for it to finish. A caller that must survive a crash or a timeout
   * stores it here, so the outcome can be looked up later instead of guessed.
   */
  readonly onOperation?: (operationId: string) => Promise<void>;
  /**
   * Asked when the lane finally runs this job, before the wallet is unlocked.
   * False means the send is no longer wanted (its debt was settled or reopened
   * while it queued), and it is refused as a definite "not sent" (audit 7).
   */
  readonly precheck?: () => Promise<boolean>;
}

/**
 * A send that was refused BEFORE z_sendmany was issued: over the cap, invalid,
 * or the wallet would not unlock. Definitely not sent, so the debt can safely
 * go back to owed. Any other failure is ambiguous - the send may be out - and
 * must be reconciled, never retried blind (audit C1).
 */
export class NotSentError extends Error {
  constructor(message: string) { super(message); this.name = 'NotSentError'; }
}

export interface AnchorResult extends ZalletOperation {
  /** True when this call returned a previously recorded operation id. */
  replayed: boolean;
}

// ── Configuration ────────────────────────────────────────────────────────────

function envInt(name: string, fallback: number, floor: number, ceiling: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(n) || n < floor) return fallback;
  return Math.min(n, ceiling);
}

function envString(name: string, fallback: string): string {
  const v = (process.env[name] ?? '').trim();
  return v.length > 0 ? v : fallback;
}

// The one wallet this module is allowed to drive. Capsule funds, the accounts
// already provisioned and the seed behind them live in E:\ZEC-Zallet. A
// container name repointed at some other Zallet would still exec, still exit 0
// and still print an operation id, so the money would move from a different seed
// with nothing in the logs to say so. Hardcoded, in the same spirit as
// assertZingoTarget in ./rpc.ts: an override would reintroduce the failure.
const ZALLET_CONTAINER = 'zec-zallet';

// Which chain the backend is operating on. Defaults to mainnet, so an install that
// sets nothing behaves exactly as before this existed.
//
// The wallet is NOT a free-form env var. The guard below still refuses any container
// outside this table, for the reason in the comment above it: a repointed name would
// exec, exit 0 and print an operation id while moving money from a different seed.
// Widening that to "whatever ZALLET_CONTAINER says" would reintroduce the failure it
// was written to prevent, so the table is the allowlist and BACKEND_NETWORK only
// chooses a row.
//
// There is deliberately no 'zsa' row. Zallet 0.1.0-beta.2 cannot follow the ZSA
// devnet at all - verified 2026-09-06 against zec-zebra-zsa: its embedded Zaino
// fails with "parse error: expected TX_V6_VERSION_GROUP_ID" and the sync aborts with
// "invalid pool name, must be one of: [sapling, orchard]". It fails loudly rather
// than silently, unlike the Zingo/NU6.3 incident, but it does not work. See
// docs/ZSA_ISSUANCE.md.
export type BackendNetwork = 'mainnet' | 'testnet';

interface WalletTarget {
  container: string;
  /** Env var holding the keystore passphrase for THIS wallet. Two wallets, two seeds. */
  passphraseEnv: string;
  /** Env var holding the address the backend receives at on THIS chain. */
  zaddrEnv: string;
}

const WALLET_TARGETS: Record<BackendNetwork, WalletTarget> = {
  mainnet: {
    // ZALLET_CONTAINER renames the MAINNET wallet only. It used to be applied in
    // execArgs, after the network had already chosen a target, so the env won and
    // every call - testnet included - went to the mainnet wallet. Silently: nothing
    // errored, testnet invoices were simply checked against the wrong wallet and
    // never settled. Scoping it here means the network dispatch is authoritative.
    container: ZALLET_CONTAINER,
    passphraseEnv: 'ZALLET_WALLET_PASSPHRASE',
    zaddrEnv: 'BACKEND_ZADDR',
  },
  testnet: {
    container: 'zec-zallet-testnet',
    passphraseEnv: 'ZALLET_TESTNET_WALLET_PASSPHRASE',
    zaddrEnv: 'BACKEND_ZADDR_TESTNET',
  },
};

export function backendNetwork(): BackendNetwork {
  // Anything unrecognised resolves to mainnet rather than throwing: a typo must not
  // take the live payment flow down, and mainnet is the conservative reading.
  return (process.env.BACKEND_NETWORK ?? '').trim() === 'testnet' ? 'testnet' : 'mainnet';
}

/**
 * The wallet for a given network.
 *
 * Callers pass the network explicitly. `backendNetwork()` remains only as the
 * default for code that genuinely has no request context, and process-wide
 * BACKEND_NETWORK must stay unset in production: one instance now serves both
 * chains, chosen per request.
 */
export function walletTargetFor(net: BackendNetwork): WalletTarget {
  return WALLET_TARGETS[net];
}

export function walletTarget(net: BackendNetwork = backendNetwork()): WalletTarget {
  return walletTargetFor(net);
}

/**
 * Networks this deployment will serve at all.
 *
 * The ceiling, borrowed from the Rings mode switch: a box never configured for
 * testnet cannot be talked into it by a request header. Mainnet is always
 * permitted, because it is the conservative default and refusing it would take
 * the live app down.
 */
/**
 * True when an order recorded on one chain is being checked against the other
 * chain's wallet. After a mode switch an open mainnet order could otherwise be
 * polled against the testnet wallet and settled with testnet coins. Mock-mode
 * orders are stored as 'mock' and are never a mismatch.
 */
export function wrongChain(orderNetwork: string, walletNet: BackendNetwork): boolean {
  return (orderNetwork === 'mainnet' || orderNetwork === 'testnet') && orderNetwork !== walletNet;
}
const WRONG_CHAIN = 'this order belongs to the other network - switch networks to check it; it also settles on its own once paid';
export const wrongChainError = { error: WRONG_CHAIN, wrongNetwork: true } as const;

export function allowedNetworks(): BackendNetwork[] {
  const raw = (process.env.BACKEND_NETWORKS ?? '').trim();
  if (!raw) return ['mainnet'];
  const set = new Set(raw.split(/[,\s]+/).filter(Boolean));
  const out: BackendNetwork[] = ['mainnet'];
  if (set.has('testnet')) out.push('testnet');
  return out;
}

const RPC_TIMEOUT_MS = envInt('ZALLET_RPC_TIMEOUT_MS', 20_000, 1_000, 120_000);
// Headroom, not the fix: the detection read is bounded to a window (rpc.ts).
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

// Dust anchoring only. Matches ZALLET_GATE_MAX_SPEND_ZATOSHI's default so the
// two spend paths agree; the ceiling is there because a mis-set env var must not
// be able to authorise a large send.
const MAX_ANCHOR_ZATOSHI = envInt('ZALLET_MAX_ANCHOR_ZATOSHI', 100_000, 1, 10_000_000);

// Payouts are a different animal: real money to a person, sized by a sale, not
// a memo. The dust cap above was written when the wallet only anchored, and
// every payout was later routed through the same gate - so no marketplace
// payout above 0.001 ZEC could ever be sent. Separate cap, separate ceiling
// (100 ZEC). Default 25 ZEC per send: a seller who is owed more is paid in
// several sends by the claim route, never refused.
const MAX_PAYOUT_ZATOSHI = envInt('ZALLET_MAX_PAYOUT_ZATOSHI', 2_500_000_000, 0, 10_000_000_000);

/** The per-send payout cap, so callers can size a send to fit rather than fail. */
export function payoutCapZat(): number { return MAX_PAYOUT_ZATOSHI; }

/** The per-send dust cap, so a batch of memos can be sized to fit rather than fail. */
export function anchorCapZat(): number { return MAX_ANCHOR_ZATOSHI; }

// FullPrivacy is Zallet's own default and the fail-closed choice: it restricts
// the send to a single shielded pool, so anything that would leak an amount or a
// transparent party has to be asked for explicitly.
const DEFAULT_PRIVACY_POLICY: ZalletPrivacyPolicy = 'FullPrivacy';
const DEFAULT_MINCONF = envInt('ZALLET_ANCHOR_MINCONF', 1, 0, 100);
const DEFAULT_WAIT_MS = envInt('ZALLET_ANCHOR_WAIT_MS', 180_000, 5_000, 600_000);
const POLL_INTERVAL_MS = envInt('ZALLET_ANCHOR_POLL_MS', 1_500, 250, 30_000);

const IDEMPOTENCY_TTL_MS = envInt('ZALLET_IDEMPOTENCY_TTL_MS', 86_400_000, 60_000, 604_800_000);
const IDEMPOTENCY_MAX_ENTRIES = envInt('ZALLET_IDEMPOTENCY_MAX_ENTRIES', 10_000, 1, 1_000_000);

// Zallet's own relock timer. It is the backstop for this process dying between
// unlock and relock, so it is derived from the caller's wait budget rather than
// configured independently: a window shorter than the operation would relock
// mid-proof and fail the send, and one longer than needed is exposure.
const UNLOCK_GRACE_SECONDS = 15;
const MAX_UNLOCK_SECONDS = 900;

const MEMO_MAX_HEX_CHARS = 1024; // 512-byte memo field
const OPERATION_ID_RE = /^[\x20-\x7e]{1,128}$/;

/** Anchoring and provisioning both need the keystore passphrase; reads do not. */
export function anchoringConfigured(): boolean {
  return (process.env[walletTarget().passphraseEnv] ?? '').length > 0;
}

function passphrase(net: BackendNetwork = backendNetwork()): string {
  const envVar = walletTargetFor(net).passphraseEnv;
  const value = process.env[envVar] ?? '';
  if (value.length === 0) throw new Error(`${envVar} not configured`);
  return value;
}

function assertZalletTarget(container: string): void {
  const allowed = Object.values(WALLET_TARGETS).map((t) => t.container);
  if (!allowed.includes(container)) {
    throw new Error(
      `ZALLET_CONTAINER "${container}" is not one of ${allowed.join(', ')} - refusing to run ` +
      'wallet commands against an unknown wallet',
    );
  }
}

// ── Transport ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Zallet ends every failure with a two-line "tell us about it" footer and logs
// INFO lines before answering, so the tail of stderr is boilerplate and the real
// JSON-RPC error sits above it. Both are dropped, or a caller trying to classify
// a failure only ever sees the footer.
function stderrDetail(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('[') && !/\sINFO\s/.test(l))
    .slice(-2)
    .join(' ');
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const stderr = isRecord(err) ? asString(err.stderr) : null;
  const detail = stderr === null ? '' : stderrDetail(stderr);
  const head = message.split('\n')[0];
  return detail.length > 0 ? `${head} - ${detail}` : head;
}

/** Carries the raw stderr so a caller can classify a JSON-RPC error code. */
class ZalletRpcError extends Error {
  readonly stderr: string;

  constructor(method: string, err: unknown) {
    super(`zallet ${method}: ${errorText(err)}`);
    this.name = 'ZalletRpcError';
    this.stderr = (isRecord(err) ? asString(err.stderr) : null) ?? '';
  }
}

// The binary writes INFO log lines to stderr before answering, and a stray line
// on stdout has been seen too, so the payload is located rather than assumed.
//
// A SCALAR result is printed BARE, not as JSON: z_sendmany answers with
// `opid-<uuid>` and not `"opid-<uuid>"`. Treating that as a parse failure cost
// a real payment - the operation had already been registered and the memo went
// out on chain, but the caller saw an error, rolled the challenge back and
// would have sent the code a second time on the next tick. So an unparseable
// single line is returned as a string rather than thrown away.
function parseRpcJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) throw new Error('zallet rpc returned no output');
  const start = trimmed.search(/[[{]/);
  const candidate = start > 0 ? trimmed.slice(start) : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Only ever a bare scalar: anything multi-line is a diagnostic we must not
    // mistake for a result.
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 1) return lines[0];
    throw new Error(`zallet rpc returned non-JSON output: ${trimmed.slice(0, 200)}`);
  }
}

function execArgs(net: BackendNetwork, method: string, params: readonly string[]): string[] {
  // The network alone picks the wallet. No env override here - see WALLET_TARGETS.
  const container = walletTargetFor(net).container;
  assertZalletTarget(container);
  const datadir = envString('ZALLET_DATADIR', '/data');
  return ['exec', container, 'zallet', '--datadir', datadir, 'rpc', method, ...params];
}

// `zallet rpc` takes each parameter as a positional JSON value, so a string
// argument arrives already quoted. execFile passes argv without a shell, so the
// quotes stay data and nothing can be injected through an address or a memo.
//
// Killing this client on timeout is safe in a way that killing zingo-cli is not
// (see the exec notes in ./rpc.ts): the work happens in the Zallet server, and
// this process is only an HTTP caller. It is NOT a cancellation, though - a
// z_sendmany that has already registered its operation keeps running, which is
// exactly why anchors are keyed for replay.
async function rpc(
  method: string,
  params: readonly string[] = [],
  timeoutMs = RPC_TIMEOUT_MS,
  net: BackendNetwork = backendNetwork(),
): Promise<unknown> {
  const t0 = Date.now();
  try {
    const { stdout } = await execFileAsync('docker', execArgs(net, method, params), {
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    });
    const out = parseRpcJson(stdout);
    recordUpstream(net === 'mainnet' ? 'zallet' : 'zallet-testnet', method, Date.now() - t0, true);
    return out;
  } catch (err) {
    recordUpstream(net === 'mainnet' ? 'zallet' : 'zallet-testnet', method, Date.now() - t0, false);
    throw new ZalletRpcError(method, err);
  }
}

// walletpassphrase cannot use rpc(): Node puts the whole failing command line in
// the error's `message` and `cmd`, so any error object from this call carries the
// passphrase. Nothing derived from it may escape this function.
//
// THE PASSPHRASE IS NOT PUT ON A COMMAND LINE. Passed as an argument to
// `docker exec` it was readable in `ps` on the host by any user for the length
// of every unlock, and the log flusher and anchor scheduler unlock constantly.
// It now goes over STDIN to a shell inside the container, which places it in
// zallet's argv there and nowhere else. If the container image has no shell,
// this falls back to the old path once, loudly.
let passphraseViaArgv = false;
async function rpcWalletPassphrase(secret: string, unlockSeconds: number, net: BackendNetwork = backendNetwork()): Promise<void> {
  const container = walletTargetFor(net).container;
  assertZalletTarget(container);
  const datadir = envString('ZALLET_DATADIR', '/data');
  const json = JSON.stringify(secret); // zallet rpc takes JSON positional params

  const fail = (stderr: string | null): never => {
    // serde quotes an offending argument back in its error text, so the upstream
    // reason is surfaced only when the passphrase is provably not in it.
    const reason = stderr !== null && !stderr.includes(secret) && !stderr.includes(json) ? stderrDetail(stderr) : 'redacted';
    console.error(`[zallet] wallet unlock failed reason=${JSON.stringify(reason)}`);
    throw new Error('zallet walletpassphrase: wallet unlock failed');
  };

  if (!passphraseViaArgv) {
    // `read -r` keeps backslashes; `$P` is expanded by the shell inside the
    // container and never touches the host's argv.
    const script = 'IFS= read -r P; exec zallet --datadir "$1" rpc walletpassphrase "$P" "$2"';
    const r = await spawnWithStdin('docker', ['exec', '-i', container, 'sh', '-c', script, 'sh', datadir, String(unlockSeconds)], `${json}\n`);
    const noShell = r.code === 126 || r.code === 127 || /executable file not found|no such file/i.test(r.stderr);
    if (!noShell) {
      if (r.code !== 0 || r.timedOut) return fail(r.stderr);
      parseRpcJson(r.stdout); // null on success; a JSON-RPC error would parse to an object
      return;
    }
    passphraseViaArgv = true;
    console.warn('[zallet] container has no shell; passphrase falls back to exec argv (visible in ps on the host)');
  }

  const args = execArgs(net, 'walletpassphrase', [json, String(unlockSeconds)]);
  try {
    const { stdout } = await execFileAsync('docker', args, { maxBuffer: 64 * 1024, timeout: RPC_TIMEOUT_MS, windowsHide: true });
    parseRpcJson(stdout);
  } catch (err) {
    return fail(isRecord(err) ? asString(err.stderr) : null);
  }
}

/** Run a command, feed it stdin, collect output. Never throws with argv in it. */
function spawnWithStdin(cmd: string, args: string[], stdin: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, RPC_TIMEOUT_MS);
    child.stdout.on('data', (d) => { if (stdout.length < 64 * 1024) stdout += String(d); });
    child.stderr.on('data', (d) => { if (stderr.length < 64 * 1024) stderr += String(d); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, stdout, stderr: `${stderr}\n${e.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => { /* closed early; reported via exit code */ });
    child.stdin.end(stdin);
  });
}

// ── Amounts ──────────────────────────────────────────────────────────────────

const ZATOSHI_DIGITS = 8;

/**
 * Exact zatoshi -> ZEC decimal text.
 *
 * z_sendmany documents its amounts as "decimal numbers with at most 8 digits of
 * precision" in ZEC, not zatoshi, so a conversion is unavoidable. `zat / 1e8` is
 * not exact - 1e-4 and 2.9e-3 have no binary representation - so the digits are
 * shifted as text and emitted as a raw JSON number token. Callers only ever deal
 * in integer zatoshi, which is also the only unit a cap can be checked in.
 */
export function zatoshiToZec(zat: number): string {
  if (!Number.isSafeInteger(zat) || zat < 0) throw new Error(`amount is not a zatoshi integer: ${zat}`);
  const digits = String(zat).padStart(ZATOSHI_DIGITS + 1, '0');
  const cut = digits.length - ZATOSHI_DIGITS;
  return `${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

// Built as text so the amount reaches the wallet as the decimal the caller meant.
// Routing it through a JS number first would hand serde whatever double happened
// to be nearest.
function amountsJson(recipients: readonly AnchorRecipient[]): string {
  const entries = recipients.map((r) => {
    const fields = [`"address":${JSON.stringify(r.address)}`, `"amount":${zatoshiToZec(r.amountZat)}`];
    if (r.memoHex !== undefined) fields.push(`"memo":${JSON.stringify(r.memoHex)}`);
    return `{${fields.join(',')}}`;
  });
  return `[${entries.join(',')}]`;
}

// ── Account parameters ───────────────────────────────────────────────────────

/** Either a UUID or a ZIP 32 account index, per the `account` parameter schema. */
export type ZalletAccountRef = string | number;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function accountParam(account: ZalletAccountRef): string {
  if (typeof account === 'number') {
    if (!Number.isSafeInteger(account) || account < 0) throw new Error(`invalid account index: ${account}`);
    return String(account);
  }
  // A free-form string would be passed to a wallet RPC verbatim; only the two
  // documented forms are accepted.
  if (UUID_RE.test(account)) return JSON.stringify(account);
  if (/^\d{1,10}$/.test(account)) return account;
  throw new Error(`account must be a UUID or a ZIP 32 account index: ${account}`);
}

// ── Spend lane ───────────────────────────────────────────────────────────────

// Zallet has no per-caller unlock: walletpassphrase and walletlock are global.
// Two overlapping anchors would therefore interleave their windows and the first
// relock would close the second's mid-flight, failing a send that had already
// been registered. So at most one job holds the wallet open at a time. The lane
// also covers the cap and idempotency checks, which makes check-then-send atomic
// within this process: two concurrent retries of one key cannot both get past
// the lookup.
//
// Same promise-chain shape as ./rpc.ts and manager/lib/zingo.ts. The tail
// swallows failures so a rejected job cannot poison the chain, while the caller
// still sees the rejection.
//
// ONE LANE PER NETWORK (audit H1). The unlock is global per Zallet, and each
// network is its own Zallet container, so the two never share a window. With
// one shared lane a sick testnet wallet held up every mainnet payout.
const lanes = new Map<BackendNetwork, Promise<unknown>>();

// Jobs waiting or running per network, with when each was enqueued. Read by the
// load beacon so browsers can back off before the queue is deep enough to hit
// Cloudflare's 100s cut-off. Bookkeeping only: it never touches the wallet.
const laneQueued = new Map<BackendNetwork, Map<number, number>>();
let laneSeq = 0;

/** Depth of a network's spend lane and the age of its oldest entry. In-memory, free. */
export function laneStats(net: BackendNetwork): { depth: number; oldestMs: number } {
  const q = laneQueued.get(net);
  if (!q || q.size === 0) return { depth: 0, oldestMs: 0 };
  let oldest = Number.POSITIVE_INFINITY;
  for (const at of q.values()) if (at < oldest) oldest = at;
  return { depth: q.size, oldestMs: Date.now() - oldest };
}

/*
 * One log line per lane job: how deep the lane was when it joined, how long it
 * waited for the wallet, and how long it held it. This is the data the beacon's
 * slow/closed thresholds (4 and 10) are waiting on - sampling the beacon from
 * outside cannot resolve a job that holds the lane for a few seconds, this can.
 * One line per spend, and spends are rare, so it costs nothing to leave on.
 */
function enqueue<T>(job: () => Promise<T>, net: BackendNetwork): Promise<T> {
  const id = ++laneSeq;
  const queuedAt = Date.now();
  const q = laneQueued.get(net) ?? new Map<number, number>();
  laneQueued.set(net, q);
  const depthAtEnqueue = q.size;
  q.set(id, queuedAt);
  let startedAt = 0;
  let ok = false;
  const run = (lanes.get(net) ?? Promise.resolve())
    .then(() => { startedAt = Date.now(); return job(); })
    .then((v) => { ok = true; return v; })
    .finally(() => {
      q.delete(id);
      const endedAt = Date.now();
      const waitMs = (startedAt || endedAt) - queuedAt;
      const runMs = startedAt ? endedAt - startedAt : 0;
      console.log(`[lane] ${net} job=${id} depthAtEnqueue=${depthAtEnqueue} waitMs=${waitMs} runMs=${runMs} ok=${ok}`);
    });
  lanes.set(net, run.catch(() => {}));
  return run;
}

function unlockSecondsFor(budgetMs: number): number {
  return Math.min(MAX_UNLOCK_SECONDS, Math.ceil(budgetMs / 1000) + UNLOCK_GRACE_SECONDS);
}

/**
 * Unlock, run, relock. Only ever called from inside enqueue(), so the window it
 * opens belongs to exactly one job.
 *
 * The relock is in a `finally` because the failure path is the dangerous one: a
 * job that throws is precisely when an unlocked wallet would otherwise be left
 * behind. A failed relock is logged, not thrown - it must not mask the result,
 * and walletpassphrase's own timer closes the window regardless.
 */
async function withWalletUnlocked<T>(budgetMs: number, job: () => Promise<T>, net: BackendNetwork = backendNetwork()): Promise<T> {
  await rpcWalletPassphrase(passphrase(net), unlockSecondsFor(budgetMs), net);
  try {
    return await job();
  } finally {
    try {
      await rpc('walletlock', undefined, undefined, net);
    } catch (err) {
      console.error(`[zallet] wallet relock failed: ${errorText(err)}`);
    }
  }
}

// ── Idempotency ──────────────────────────────────────────────────────────────
//
// IN-MEMORY ONLY, and that is a deliberate, bounded compromise rather than a
// complete answer:
//   - a process restart loses the whole window, so a retry after a restart is a
//     fresh send and can pay twice;
//   - a crash between z_sendmany returning and the record being written can
//     double-pay on retry even without a restart, because the operation is live
//     in Zallet but unknown here.
// It closes the common case only: a caller that timed out waiting and retries
// inside the same process. Durable idempotency needs a store shared with the
// consumer of the anchor, which is a schema decision, not this module's call.
// Reconciling against z_listtransactions / z_getoperationstatus remains the only
// way to be sure a retry is not a second payment.

interface AnchorRecord {
  operationId: string;
  fingerprint: string;
  createdAt: number;
}

/*
 * Replay guard, IN MEMORY ONLY.
 *
 * A restart clears it, and the caller's next attempt is then a genuine
 * re-send rather than a replay. For dust-to-self that is merely untidy, but for
 * anything whose duplicate matters - the registry log, which must not carry a
 * sequence number twice - the caller cannot rely on this and must check the
 * chain itself. `flushLog` does exactly that.
 */
const anchorRecords = new Map<string, AnchorRecord>();

function fingerprint(request: AnchorRequest, policy: ZalletPrivacyPolicy, minconf: number): string {
  const canonical = JSON.stringify({
    from: request.fromAddress,
    to: request.recipients.map((r) => [r.address, r.amountZat, r.memoHex ?? null]),
    policy,
    minconf,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function pruneAnchorRecords(now: number): void {
  for (const [key, record] of anchorRecords) {
    if (now - record.createdAt > IDEMPOTENCY_TTL_MS) anchorRecords.delete(key);
  }
  // Map iterates in insertion order, so the oldest keys leave first.
  while (anchorRecords.size >= IDEMPOTENCY_MAX_ENTRIES) {
    const oldest = anchorRecords.keys().next();
    if (oldest.done === true) break;
    anchorRecords.delete(oldest.value);
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

function parseAddresses(value: unknown): ZalletCapsuleAddress[] {
  if (!Array.isArray(value)) return [];
  const out: ZalletCapsuleAddress[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    // Only the `ua` form is a capsule address; the bare sapling/transparent
    // entries a wallet may also list cannot bind a send to one account.
    const address = asString(entry.ua);
    if (address === null) continue;
    out.push({ address, diversifierIndex: asNumber(entry.diversifier_index) });
  }
  return out;
}

/**
 * z_listaccounts([include_addresses]) - Account3[]:
 * account_uuid, name?, seedfp?, zip32_account_index?, addresses[].
 */
export async function listCapsules(includeAddresses = true, net: BackendNetwork = backendNetwork()): Promise<ZalletCapsuleAccount[]> {
  const result = await rpc('z_listaccounts', [includeAddresses ? 'true' : 'false'], undefined, net);
  if (!Array.isArray(result)) throw new Error('z_listaccounts: expected an array');
  const out: ZalletCapsuleAccount[] = [];
  for (const entry of result) {
    if (!isRecord(entry)) continue;
    const accountUuid = asString(entry.account_uuid);
    if (accountUuid === null) continue;
    out.push({
      accountUuid,
      name: asString(entry.name),
      zip32AccountIndex: asNumber(entry.zip32_account_index),
      seedfp: asString(entry.seedfp),
      addresses: parseAddresses(entry.addresses),
    });
  }
  return out;
}

/**
 * z_getbalanceforaccount(account, [minconf]) - BalanceForAccount:
 * pools{transparent|sapling|orchard|ironwood: {valueZat}}, minimum_confirmations.
 * Pools are read as a map so a new one (ironwood, post-NU6.3) needs no change
 * here, and zero-balance pools are omitted upstream.
 */
export async function getCapsuleBalance(
  account: ZalletAccountRef,
  minconf = DEFAULT_MINCONF,
): Promise<ZalletCapsuleBalance> {
  const result = await rpc('z_getbalanceforaccount', [accountParam(account), String(minconf)]);
  const source = isRecord(result) ? result : {};
  const pools: ZalletPoolBalance[] = [];
  let totalZat = 0;
  if (isRecord(source.pools)) {
    for (const [pool, raw] of Object.entries(source.pools)) {
      const valueZat = isRecord(raw) ? asNumber(raw.valueZat) : null;
      if (valueZat === null) continue;
      pools.push({ pool, valueZat });
      totalZat += valueZat;
    }
  }
  return { pools, totalZat, minimumConfirmations: asNumber(source.minimum_confirmations) };
}

/**
 * getwalletstatus - {node_tip{height,blockhash}, wallet_tip{...}, fully_synced_height}
 *
 * The scan-lag signal. Needed because a wallet that cannot scan fails SILENTLY:
 * reads keep succeeding and simply return nothing new, which is what let the
 * zingo Ironwood outage run from 2026-07-28 to 2026-09-04 undetected. Callers
 * compare fullySyncedHeight against nodeTipHeight and refuse to conclude
 * "no payment" from a stale wallet.
 */
export async function getWalletStatus(net: BackendNetwork = backendNetwork()): Promise<ZalletWalletStatus> {
  const result = await rpc('getwalletstatus', undefined, undefined, net);
  const source = isRecord(result) ? result : {};
  const height = (value: unknown): number | null => (isRecord(value) ? asNumber(value.height) : null);
  return {
    nodeTipHeight: height(source.node_tip),
    walletTipHeight: height(source.wallet_tip),
    fullySyncedHeight: asNumber(source.fully_synced_height),
  };
}

/** Resolves the account that holds a given address, or null. */
export async function accountForAddress(address: string, net: BackendNetwork = backendNetwork()): Promise<ZalletCapsuleAccount | null> {
  if (address.trim().length === 0) return null;
  const accounts = await listCapsules(true, net);
  return accounts.find((a) => a.addresses.some((x) => x.address === address)) ?? null;
}

function parseTxOutputs(value: unknown): ZalletTxOutput[] {
  if (!Array.isArray(value)) return [];
  const out: ZalletTxOutput[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    out.push({
      pool: asString(entry.pool) ?? '',
      outputIndex: asNumber(entry.output_index),
      toAccount: asString(entry.to_account),
      fromAccount: asString(entry.from_account),
      toAddress: asString(entry.to_address),
      valueZat: asNumber(entry.value) ?? 0,
      isChange: entry.is_change === true,
      memo: asString(entry.memo),
    });
  }
  return out;
}

/**
 * z_listtransactions([account_uuid], [start_height], [end_height], [offset], [limit])
 * - TransactionSummary[], each carrying its per-output detail and memos.
 *
 * Omitting start_height scans from the account birthday, which is what a memo
 * reconciler wants: a window relative to the tip would silently drop a payment
 * older than the window, and that is the exact failure being recovered from.
 *
 * Flagged experimental upstream, so the shape is parsed defensively.
 */
export async function listAccountTransactions(
  account: ZalletAccountRef,
  net: BackendNetwork = backendNetwork(),
  startHeight?: number,
): Promise<ZalletTransaction[]> {
  const params = [accountParam(account)];
  if (startHeight !== undefined) {
    if (!Number.isSafeInteger(startHeight) || startHeight < 0) {
      throw new Error(`invalid start height: ${startHeight}`);
    }
    params.push(String(startHeight));
  }
  const result = await rpc('z_listtransactions', params, undefined, net);
  if (!Array.isArray(result)) throw new Error('z_listtransactions: expected an array');
  const out: ZalletTransaction[] = [];
  for (const entry of result) {
    if (!isRecord(entry)) continue;
    const txid = asString(entry.txid);
    if (txid === null) continue;
    out.push({
      txid,
      minedHeight: asNumber(entry.mined_height),
      blockTime: asNumber(entry.block_time),
      feePaidZat: asNumber(entry.fee_paid),
      expiredUnmined: entry.expired_unmined === true,
      outputs: parseTxOutputs(entry.outputs),
    });
  }
  return out;
}

/**
 * The unified address a send from this capsule must use as `fromaddress`.
 * Picks the lowest diversifier index so repeated calls agree on one address.
 */
export async function capsuleAddress(account: ZalletAccountRef): Promise<string> {
  const wanted = typeof account === 'number' ? String(account) : account;
  const accounts = await listCapsules(true);
  const match = accounts.find(
    (a) => a.accountUuid === wanted || String(a.zip32AccountIndex) === wanted,
  );
  if (match === undefined) throw new Error(`capsule not found: ${wanted}`);
  const sorted = [...match.addresses].sort(
    (a, b) => (a.diversifierIndex ?? Number.MAX_SAFE_INTEGER) - (b.diversifierIndex ?? Number.MAX_SAFE_INTEGER),
  );
  const first = sorted[0];
  if (first === undefined) throw new Error(`capsule ${wanted} has no unified address`);
  return first.address;
}

// ── Provisioning ─────────────────────────────────────────────────────────────

/**
 * z_getnewaccount(account_name, [seedfp]) - {account_uuid, account?}
 * z_getaddressforaccount(account, [receiver_types], [diversifier_index]) -
 *   {account_uuid, account?, diversifier_index, receiver_types, address}
 *
 * Both derive from the encrypted seed, so they run inside an unlock window; the
 * pair also runs as one lane job, since a capsule without an address is not a
 * capsule. Passing no receiver_types takes Zallet's default set (best and
 * second-best shielded, plus p2pkh) and the next unused diversifier index.
 */
export async function provisionCapsule(name: string, seedfp?: string): Promise<ZalletCapsule> {
  if (name.trim().length === 0) throw new Error('capsule name is required');
  const budgetMs = RPC_TIMEOUT_MS * 2;

  return enqueue(() =>
    withWalletUnlocked(budgetMs, async () => {
      const params = seedfp === undefined ? [JSON.stringify(name)] : [JSON.stringify(name), JSON.stringify(seedfp)];
      const created = await rpc('z_getnewaccount', params);
      if (!isRecord(created)) throw new Error('z_getnewaccount: expected an object');
      const accountUuid = asString(created.account_uuid);
      if (accountUuid === null) throw new Error('z_getnewaccount: no account_uuid in response');

      const derived = await rpc('z_getaddressforaccount', [JSON.stringify(accountUuid)]);
      if (!isRecord(derived)) throw new Error('z_getaddressforaccount: expected an object');
      const address = asString(derived.address);
      if (address === null) throw new Error('z_getaddressforaccount: no address in response');

      const capsule: ZalletCapsule = {
        accountUuid,
        zip32AccountIndex: asNumber(created.account) ?? asNumber(derived.account),
        address,
        diversifierIndex: asNumber(derived.diversifier_index),
        receiverTypes: Array.isArray(derived.receiver_types)
          ? derived.receiver_types.filter((t): t is string => typeof t === 'string')
          : [],
      };
      console.log(
        `[zallet] capsule provisioned ${JSON.stringify({
          accountUuid: capsule.accountUuid,
          zip32AccountIndex: capsule.zip32AccountIndex,
          receiverTypes: capsule.receiverTypes,
        })}`,
      );
      return capsule;
    }),
    backendNetwork(),
  );
}

// ── Operations ───────────────────────────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<string> = new Set(['Cancelled', 'Failed', 'Success']);

// The OpenRPC schema capitalises these, but the running binary emits them
// lower-cased ("success"), verified against opid-169cda89 on 2026-09-04.
// Matching only the schema spelling left every state unrecognised, hence never
// terminal, so waitForAnchor polled a finished operation until its whole budget
// expired - holding the wallet unlocked and the HTTP caller blocked for two
// minutes on a send that took two seconds. Compared case-insensitively so
// either spelling works.
const OPERATION_STATES: ReadonlyMap<string, ZalletOperationState> = new Map(
  (['Ready', 'Executing', 'Cancelled', 'Failed', 'Success'] as const).map((s) => [s.toLowerCase(), s]),
);

function parseState(value: unknown): ZalletOperationState | null {
  const state = asString(value);
  if (state === null) return null;
  return OPERATION_STATES.get(state.toLowerCase()) ?? null;
}

// The success result is the operation's own value; zcashd-derived callers expect
// {txid}, but a bare txid string is accepted too rather than losing the id to a
// shape change.
function parseTxid(result: unknown): string | null {
  if (isRecord(result)) return asString(result.txid);
  const bare = asString(result);
  return bare !== null && /^[0-9a-f]{64}$/i.test(bare) ? bare : null;
}

function parseOperation(entry: unknown): ZalletOperation | null {
  if (!isRecord(entry)) return null;
  const operationId = asString(entry.id);
  if (operationId === null) return null;
  const state = parseState(entry.status);
  const error = isRecord(entry.error) ? asString(entry.error.message) : null;
  const code = isRecord(entry.error) ? asNumber(entry.error.code) : null;
  return {
    operationId,
    state,
    terminal: state !== null && TERMINAL_STATES.has(state),
    txid: parseTxid(entry.result),
    error: error === null ? null : code === null ? error : `${error} (code ${code})`,
    creationTime: asNumber(entry.creation_time),
    executionSecs: asNumber(entry.execution_secs),
  };
}

// An id the wallet does not know comes back as a JSON-RPC error, not an empty
// list (verified: code ServerError(-8) "Invalid operation ID"), so it has to be
// told apart from a real transport failure - a reconcile that cannot distinguish
// the two would treat every docker hiccup as "operation gone".
const UNKNOWN_OPERATION = /Invalid operation ID|ServerError\(-8\)/i;

// Both listing methods take an ARRAY of ids and are rejected outright when the
// parameter is omitted, despite the help calling it optional.
async function queryOperation(method: string, operationId: string, net: BackendNetwork = backendNetwork()): Promise<ZalletOperation | null> {
  if (!OPERATION_ID_RE.test(operationId)) throw new Error('invalid operation id');
  let result: unknown;
  try {
    result = await rpc(method, [JSON.stringify([operationId])], undefined, net);
  } catch (err) {
    const text = err instanceof ZalletRpcError ? `${err.message} ${err.stderr}` : String(err);
    if (UNKNOWN_OPERATION.test(text)) return null;
    throw err;
  }
  if (!Array.isArray(result)) throw new Error(`${method}: expected an array`);
  for (const entry of result) {
    const op = parseOperation(entry);
    if (op !== null && op.operationId === operationId) return op;
  }
  return null;
}

/**
 * z_getoperationstatus([operationid]) - OperationStatus[]:
 * id, method?, params?, status, creation_time, error?, result?, execution_secs?.
 * Non-destructive: the operation stays in memory, so this is safe to poll and
 * safe to call from more than one place.
 *
 * Null means the wallet does not know the id - consumed by z_getoperationresult,
 * or lost to a Zallet restart. That is not "did not happen": the transaction may
 * be on chain, and only z_listtransactions can settle it.
 */
export function getAnchorOperation(operationId: string, net: BackendNetwork = backendNetwork()): Promise<ZalletOperation | null> {
  return queryOperation('z_getoperationstatus', operationId, net);
}

/**
 * z_getoperationresult([operationid]) - same shape, but REMOVES the operation
 * from memory, and answers only for operations that have finished. Only for a
 * caller that has durably recorded the outcome: after this, no other reader can
 * reconcile the id.
 */
export function takeAnchorResult(operationId: string, net: BackendNetwork = backendNetwork()): Promise<ZalletOperation | null> {
  return queryOperation('z_getoperationresult', operationId, net);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls to a terminal state so no caller has to. Resolves with terminal=false on
 * timeout, or when the wallet has forgotten the id, rather than throwing: the
 * operation id is the only handle on an in-flight spend and losing it to an
 * exception is worse than reporting an unfinished state.
 */
export async function waitForAnchor(operationId: string, timeoutMs = DEFAULT_WAIT_MS, net: BackendNetwork = backendNetwork()): Promise<ZalletOperation> {
  const deadline = Date.now() + timeoutMs;
  let last: ZalletOperation = {
    operationId,
    state: null,
    terminal: false,
    txid: null,
    error: null,
    creationTime: null,
    executionSecs: null,
  };
  for (;;) {
    const op = await getAnchorOperation(operationId, net);
    if (op === null) return { ...last, terminal: false };
    last = op;
    if (op.terminal) return op;
    if (Date.now() + POLL_INTERVAL_MS > deadline) return op;
    await sleep(POLL_INTERVAL_MS);
  }
}

// ── Anchoring ────────────────────────────────────────────────────────────────

function validateRecipients(recipients: readonly AnchorRecipient[]): number {
  if (recipients.length === 0) throw new Error('anchor requires at least one recipient');
  let total = 0;
  for (const r of recipients) {
    if (r.address.trim().length === 0) throw new Error('recipient address is required');
    if (!Number.isSafeInteger(r.amountZat) || r.amountZat <= 0) {
      throw new Error(`recipient amount must be a positive zatoshi integer: ${r.amountZat}`);
    }
    if (r.memoHex !== undefined) {
      if (!/^(?:[0-9a-fA-F]{2})*$/.test(r.memoHex) || r.memoHex.length > MEMO_MAX_HEX_CHARS) {
        throw new Error('memo must be hex of at most 512 bytes');
      }
    }
    total += r.amountZat;
    if (!Number.isSafeInteger(total)) throw new Error('anchor total overflowed');
  }
  return total;
}

function logAnchor(fields: Record<string, unknown>): void {
  // One line per attempt, machine-readable, and never the passphrase: only ids,
  // the amount and the decision appear here.
  console.log(`[zallet] anchor ${JSON.stringify(fields)}`);
}

/**
 * z_sendmany(fromaddress, amounts, [minconf], [fee], [privacy_policy]) -
 * returns an operation id string.
 *
 * `fee` must be null if given: Zallet always uses the ZIP 317 fee. It is passed
 * explicitly because the arguments are positional and privacy_policy sits behind
 * it. Amounts are ZEC decimals (see zatoshiToZec).
 *
 * The whole unlock -> send -> settle -> relock sequence is one lane job. The
 * relock cannot come earlier: z_sendmany is asynchronous and its operation signs
 * after the RPC has already returned, so the window has to stay open until the
 * operation reaches a terminal state.
 */
export async function anchor(
  request: AnchorRequest,
  /**
   * Which wallet spends. NOT optional in practice - every caller arrives via
   * zSendMany, which knows. The default exists only so the signature stays
   * compatible, and it resolves to mainnet, which is the conservative reading.
   */
  net: BackendNetwork = backendNetwork(),
): Promise<AnchorResult> {
  const policy = request.privacyPolicy ?? DEFAULT_PRIVACY_POLICY;
  const minconf = request.minconf ?? DEFAULT_MINCONF;
  const waitMs = request.waitMs ?? DEFAULT_WAIT_MS;
  const key = request.idempotencyKey;
  if (key.trim().length === 0) throw new Error('idempotencyKey is required');

  const totalZat = validateRecipients(request.recipients);
  const base = {
    capsule: request.capsule ?? request.fromAddress.slice(0, 16),
    amountZat: totalZat,
    outputs: request.recipients.length,
    idempotencyKey: key,
  };

  const purpose = request.purpose ?? 'dust';
  const capZat = purpose === 'payout' ? MAX_PAYOUT_ZATOSHI : MAX_ANCHOR_ZATOSHI;
  if (totalZat > capZat) {
    logAnchor({ ...base, decision: 'rejected:over-cap', capZat, operationId: null });
    throw new NotSentError(
      purpose === 'payout' && capZat === 0
        ? 'payouts are switched off on this box (ZALLET_MAX_PAYOUT_ZATOSHI is 0)'
        : `${purpose} amount ${totalZat} zat exceeds the per-send cap of ${capZat} zat`,
    );
  }

  const print = fingerprint(request, policy, minconf);

  // Everything that fails before z_sendmany is issued - the lane refusing the
  // job, the unlock failing - is a definite "not sent" (NotSentError).
  let issued = false;
  return enqueue(async () => {
    const now = Date.now();
    pruneAnchorRecords(now);

    const seen = anchorRecords.get(key);
    if (seen !== undefined) {
      // A replay: this key's send WAS issued earlier, so no failure from here on
      // can prove the money stayed home.
      issued = true;
      // A key reused for different terms is a caller bug, and answering it with
      // the earlier operation would hide the mismatch behind a plausible id.
      if (seen.fingerprint !== print) {
        logAnchor({ ...base, decision: 'rejected:key-reused', operationId: seen.operationId });
        throw new Error(`idempotencyKey ${key} was already used for a different anchor`);
      }
      logAnchor({ ...base, decision: 'replayed', operationId: seen.operationId });
      // `net` matters as much here as on the send path: this is the REPLAY
      // branch, so without it a retry that correctly skips re-sending still
      // cannot resolve its own outcome - it asks the mainnet wallet about a
      // testnet operation id, gets nothing, and reports "no txid" forever.
      const op = await waitForAnchor(seen.operationId, waitMs, net);
      return { ...op, replayed: true };
    }

    if (request.precheck && !(await request.precheck())) {
      logAnchor({ ...base, decision: 'rejected:no-longer-owed', operationId: null });
      throw new NotSentError('this send is no longer wanted - its debt changed while it waited in the lane');
    }

    return withWalletUnlocked(waitMs, async () => {
      issued = true;
      const sent = await rpc(
        'z_sendmany',
        [
          JSON.stringify(request.fromAddress),
          amountsJson(request.recipients),
          String(minconf),
          'null',
          JSON.stringify(policy),
        ],
        RPC_TIMEOUT_MS,
        net,
      );
      const operationId = asString(sent);
      if (operationId === null) throw new Error('z_sendmany: no operation id in response');

      // Recorded before the wait: a caller that gives up mid-operation must find
      // this id on retry instead of starting a second payment.
      anchorRecords.set(key, { operationId, fingerprint: print, createdAt: Date.now() });
      logAnchor({ ...base, decision: 'sent', policy, minconf, operationId });
      if (request.onOperation) {
        // A failure to record it must not turn a sent payment into a thrown
        // "failure": the send is out either way, and the reconciler can still
        // find it in the wallet's history.
        await request.onOperation(operationId).catch((e) => console.error('[zallet] could not record operation id', operationId, e));
      }

      const op = await waitForAnchor(operationId, waitMs, net);
      logAnchor({
        ...base,
        decision: op.terminal ? `settled:${op.state ?? 'unknown'}` : 'pending',
        operationId,
        txid: op.txid,
        error: op.error,
      });
      return { ...op, replayed: false };
    }, net);
  }, net).catch((e) => {
    if (!issued && !(e instanceof NotSentError)) throw new NotSentError(e instanceof Error ? e.message : String(e));
    throw e;
  });
}
