import { prisma } from './prisma';
import { looksLikeAddress } from '../wallet/rpc';
import type { BackendNetwork } from '../wallet/zallet';

/**
 * Addresses an account has proven, beyond the one it was created from.
 *
 * THE PROBLEM THIS SOLVES
 * A wallet issues a new unified address at every diversifier index, so one key
 * produces many valid strings. Identity was a single exact string, so the
 * person who proved with one receiver and later pasted a fresh UA was a
 * stranger - and verifying with it did not fail cleanly, it created a SECOND
 * account, which then collided on the display name and needed a sysop to
 * untangle.
 *
 * THE RULE
 * `User.address` stays authoritative and keeps its unique index. This table is
 * consulted only when that misses, so nothing existing changes behaviour and
 * every read has a path back to the old one. `UserAddress.address` is unique
 * globally, so the old guarantee holds: one address, at most one account.
 */

/**
 * The account that owns this address, by the primary column first and the
 * proven-address table second. Null when nobody owns it.
 */
export async function findUserByAddress(address: string) {
  const addr = address.trim();
  if (!addr) return null;
  const direct = await prisma.user.findUnique({ where: { address: addr } });
  if (direct) return direct;
  const alt = await prisma.userAddress.findUnique({ where: { address: addr }, include: { user: true } });
  return alt?.user ?? null;
}

/**
 * Record a proven address. Idempotent, and it never steals: an address already
 * held by ANOTHER account is left alone and reported, because moving it would
 * silently transfer whatever that address is capped and priced for.
 */
export async function addProvenAddress(
  userId: string, address: string, net: BackendNetwork, isPrimary = false,
): Promise<'added' | 'already-yours' | 'held-by-another'> {
  const addr = address.trim();
  if (!addr) return 'held-by-another';
  const existing = await prisma.userAddress.findUnique({ where: { address: addr } });
  if (existing) return existing.userId === userId ? 'already-yours' : 'held-by-another';
  try {
    await prisma.userAddress.create({ data: { userId, address: addr, network: net, isPrimary } });
    return 'added';
  } catch {
    // Lost a race to another writer; re-read decides who holds it.
    const now = await prisma.userAddress.findUnique({ where: { address: addr } });
    return now?.userId === userId ? 'already-yours' : 'held-by-another';
  }
}

/**
 * Every address this account has proven on one network, newest last.
 *
 * Includes the columns that predate this table, so a caller sees one list
 * rather than having to remember where each address lives.
 */
export async function provenAddressesFor(
  user: { id: string; address: string; testnetAddress?: string | null; isVerified: boolean; frozen: string | null } | null,
  net: BackendNetwork,
): Promise<string[]> {
  if (!user || !user.isVerified || user.frozen) return [];
  const out: string[] = [];
  const columns = net === 'testnet' ? [user.testnetAddress, user.address] : [user.address];
  for (const c of columns) if (c && looksLikeAddress(c, net) && !out.includes(c)) out.push(c);
  const rows = await prisma.userAddress.findMany({
    where: { userId: user.id, network: net }, orderBy: { verifiedAt: 'asc' }, select: { address: true },
  });
  for (const r of rows) if (!out.includes(r.address) && looksLikeAddress(r.address, net)) out.push(r.address);
  return out;
}

/**
 * Copy what already exists into the table, once, at boot.
 *
 * Idempotent and safe to re-run: every write is guarded by the unique index and
 * a failure is swallowed per row, so one bad address cannot stop the rest. The
 * primary flag marks the row that came from `User.address`, which is the one
 * that must never be removable.
 */
export async function backfillUserAddresses(): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: { isVerified: true },
      select: { id: true, address: true, testnetAddress: true },
    });
    let added = 0;
    for (const u of users) {
      if (u.address && looksLikeAddress(u.address, 'mainnet')) {
        if (await addProvenAddress(u.id, u.address, 'mainnet', true) === 'added') added++;
      }
      if (u.testnetAddress && looksLikeAddress(u.testnetAddress, 'testnet')) {
        if (await addProvenAddress(u.id, u.testnetAddress, 'testnet') === 'added') added++;
      }
    }
    if (added) console.log(`[auth] backfilled ${added} proven address(es)`);
  } catch (e) {
    // The table may predate the migration on this box. The old columns still
    // answer every lookup, so this is a missing improvement, not an outage.
    console.warn('[auth] proven-address backfill skipped', e instanceof Error ? e.message : e);
  }
}
