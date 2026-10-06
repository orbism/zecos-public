import { Prisma } from '@prisma/client';
import { prisma, type Tx } from './prisma';
import { decodeMemoHex, zListReceivedByAddress } from '../wallet/rpc';
import type { BackendNetwork } from '../wallet/zallet';

/**
 * Payment matching, done once for every paid flow (cuts, market buys, contest
 * and RPG entries).
 *
 * Two rules, both of which used to be missing:
 *
 *  1. The memo must BE the invoice marker, not merely contain it. A substring
 *     test let one 512-byte memo name a dozen invoices at once.
 *  2. A payment OUTPUT is spent when it settles an order. The claim row is
 *     written in the same transaction that flips the order to paid, and it is
 *     unique, so the same output can never settle a second order - and two
 *     orders racing for one output cannot both win.
 *
 * Claims are per OUTPUT since round 119 (audit 15): (network, txid, noteRef),
 * noteRef = "<pool>:<output_index>" as Zallet reports it, in PaymentNoteClaim.
 * One transaction paying two invoices (two outputs, two memos) used to settle
 * only the first; the second was stranded with no refund. Claims written
 * before that (PaymentClaim, one per txid) still cover their WHOLE transaction,
 * forever, so nothing already settled can be re-read as unclaimed. A note with
 * no output index (an older wallet) is claimed the old way, whole transaction.
 */

export type PaymentPurpose = 'ring-cut' | 'market-buy' | 'ring-send' | 'contest' | 'rpg' | 'auth' | 'spend' | 'stray';

export interface ReceivedNote { txid: string; memo: string; amountZat?: number | null; noteRef?: string }

/** The whole memo, trailing NULs and whitespace stripped, must equal the marker. */
export function memoIs(memoHex: string, marker: string): boolean {
  return decodeMemoHex(memoHex).trim() === marker;
}

/*
 * A per-output claim also leaves a SHADOW row in PaymentClaim (orderKey
 * "shadow:..."), the first one per transaction only. Code before round 119 reads
 * only PaymentClaim, so if it ever ran again (a rollback) it would see these
 * transactions as claimed and refund nothing; without the shadow its stray sweep
 * would refund every payment settled since. This code ignores shadow rows.
 */
const SHADOW = 'shadow:';
const isShadow = (orderKey: string) => orderKey.startsWith(SHADOW);

/** Every claim touching these transactions: whole-tx (legacy) and per-output. */
async function claimsFor(network: string, txids: string[]) {
  const ids = [...new Set(txids)];
  const [legacy, outputs] = ids.length
    ? await Promise.all([
        prisma.paymentClaim.findMany({ where: { network, txid: { in: ids } }, select: { txid: true, orderKey: true } }),
        prisma.paymentNoteClaim.findMany({ where: { network, txid: { in: ids } }, select: { txid: true, noteRef: true, orderKey: true } }),
      ])
    : [[], []];
  const byTx = new Map<string, Set<string>>();
  for (const o of outputs) byTx.set(o.txid, (byTx.get(o.txid) ?? new Set()).add(o.orderKey));
  return {
    legacy: new Map(legacy.filter((c) => !isShadow(c.orderKey)).map((c) => [c.txid, c.orderKey])),
    output: new Map(outputs.map((c) => [`${c.txid}|${c.noteRef}`, c.orderKey])),
    byTx,
  };
}
type Claims = Awaited<ReturnType<typeof claimsFor>>;

/** Who holds this note: 'free', 'mine' (this orderKey) or 'foreign'. */
function holder(c: Claims, n: ReceivedNote, orderKey?: string): 'free' | 'mine' | 'foreign' {
  const of = (k: string | undefined) => (k === undefined ? 'free' : k === orderKey ? 'mine' : 'foreign');
  // A whole-transaction claim (written before round 119, or by an older wallet) covers every output.
  const legacy = c.legacy.get(n.txid);
  if (legacy !== undefined) return of(legacy);
  if (n.noteRef) return of(c.output.get(`${n.txid}|${n.noteRef}`));
  // No output index: the note can only be told apart by its transaction.
  const keys = c.byTx.get(n.txid);
  if (!keys || keys.size === 0) return 'free';
  if (orderKey !== undefined && keys.has(orderKey) && keys.size === 1) return 'mine';
  return 'foreign';
}

/**
 * The note that pays this invoice and is not already spent on a DIFFERENT
 * order. A note this order already claimed (a re-poll after the flip) is
 * preferred, so polling stays idempotent and never reaches for a second one.
 */
/**
 * Display only: the total this memo has received in notes SMALLER than the amount
 * due, in zat. A short note never settles an order; the stray sweep refunds it
 * once the order is no longer open. Shown so the payer is not left waiting.
 */
export function shortPaidZat(notes: ReceivedNote[], marker: string, valueZat: number): number {
  return notes.filter((n) => memoIs(n.memo, marker) && (n.amountZat ?? 0) < valueZat).reduce((s, n) => s + (n.amountZat ?? 0), 0);
}

export async function findFundingNote<N extends ReceivedNote>(
  network: string, notes: N[], marker: string, valueZat: number, orderKey: string,
): Promise<N | null> {
  const hits = notes.filter((n) => memoIs(n.memo, marker) && (n.amountZat ?? 0) >= valueZat);
  if (hits.length === 0) return null;
  const c = await claimsFor(network, hits.map((h) => h.txid));
  return hits.find((h) => holder(c, h, orderKey) === 'mine') ?? hits.find((h) => holder(c, h, orderKey) === 'free') ?? null;
}

/** For the stray sweep: which of these notes already belong to some order or stray refund. */
export async function claimedNotes<N extends ReceivedNote>(network: string, notes: N[]): Promise<(n: N) => boolean> {
  const c = await claimsFor(network, notes.map((n) => n.txid));
  return (n) => holder(c, n) !== 'free';
}

/** Record a claim on one note inside a transaction: per output when the wallet named it, else whole tx. */
export async function recordClaim(
  tx: Tx, args: { network: string; txid: string; noteRef?: string; purpose: PaymentPurpose; orderKey: string },
): Promise<void> {
  if (args.noteRef) {
    await tx.paymentNoteClaim.create({ data: { network: args.network, txid: args.txid, noteRef: args.noteRef, purpose: args.purpose, orderKey: args.orderKey } });
    await tx.paymentClaim.createMany({
      data: [{ network: args.network, txid: args.txid, purpose: args.purpose, orderKey: `${SHADOW}${args.orderKey}` }],
      skipDuplicates: true,
    });
  } else {
    await tx.paymentClaim.create({ data: { network: args.network, txid: args.txid, purpose: args.purpose, orderKey: args.orderKey } });
  }
}

/**
 * Every memo the wallet has received lately, read ONCE (audit 16).
 *
 * The reconcilers used to check the oldest 200 unpaid orders one by one, so
 * abandoned invoices crowded out paid ones for days under load. Now a pass
 * reads the wallet once, keeps only the orders whose memo actually arrived,
 * and runs the full check (amount, confirmations, claim) for just those.
 * Null when the wallet cannot be read: the pass then does nothing and the
 * next one tries again.
 */
export async function memosReceived(net: BackendNetwork, address: string): Promise<Set<string> | null> {
  try {
    const notes = await zListReceivedByAddress(address, 0, net, { includeSelfSends: true });
    return new Set(notes.map((n) => decodeMemoHex(n.memo).trim()));
  } catch {
    return null;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * Run `flip` (the status update) only if this note can be claimed for this
 * order. Returns whatever `flip` returns, or 0 when the note belongs to another
 * order.
 *
 * The flip runs first and the claim is written only if it changed something,
 * in the SAME transaction: a re-poll of an order already paid writes nothing
 * (so it can never mark an extra output as used), and of two orders racing for
 * one note the loser fails on the unique index and its whole transaction,
 * flip included, rolls back - which is exactly "not paid".
 *
 * `txid` may be undefined in mock mode, where there is nothing to spend.
 * `noteRef` is the output (see the file header); without it the claim is the
 * whole transaction, as it always was.
 */
export async function withClaim(
  args: { network: string; txid: string | undefined; noteRef?: string; purpose: PaymentPurpose; orderKey: string },
  flip: (tx: Tx) => Promise<number>,
): Promise<number> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (!args.txid) return flip(tx);
      const found = await tx.paymentClaim.findUnique({ where: { network_txid: { network: args.network, txid: args.txid } } });
      const legacy = found && !isShadow(found.orderKey) ? found : null;
      if (legacy) return legacy.orderKey === args.orderKey ? flip(tx) : 0;
      if (args.noteRef) {
        const held = await tx.paymentNoteClaim.findUnique({
          where: { network_txid_noteRef: { network: args.network, txid: args.txid, noteRef: args.noteRef } },
        });
        if (held && held.orderKey !== args.orderKey) return 0;
        const n = await flip(tx);
        if (!held && n > 0) await recordClaim(tx, { ...args, txid: args.txid });
        return n;
      }
      // No output index: claim the whole transaction, and only if no output of it is someone else's.
      const others = await tx.paymentNoteClaim.count({ where: { network: args.network, txid: args.txid, orderKey: { not: args.orderKey } } });
      if (others > 0) return 0;
      const n = await flip(tx);
      if (n > 0) await recordClaim(tx, { ...args, txid: args.txid, noteRef: undefined });
      return n;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return 0;
    throw e;
  }
}
