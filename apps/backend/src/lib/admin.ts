import { prisma } from './prisma';

/**
 * Who the sysop is.
 *
 * Admin used to be "a verified user whose display name is ADMIN_HANDLE". A
 * display name is something any account can set, and until recently could be
 * changed on someone ELSE's row through an unauthenticated route - so the
 * handle was a label, not a credential. The credential is the Zcash address
 * the sysop proved control of: set ADMIN_ADDRESS to it. Unset means nobody
 * is admin, which is the safe default for a fresh install.
 *
 * ADMIN_HANDLE remains the sysop's DISPLAY name (chat rendering, the reserved
 * handle) and grants nothing on its own.
 */
export function adminAddress(): string {
  return (process.env.ADMIN_ADDRESS ?? '').trim();
}

export function adminHandle(): string {
  return (process.env.ADMIN_HANDLE ?? 'sysop').trim();
}

export function isAdmin(user: { address?: string | null } | null | undefined): boolean {
  const a = adminAddress();
  return !!user && a !== '' && (user.address ?? '') === a;
}

/**
 * May SEE the sysop's tooling (never act): the sysop, or a sudobud the sysop
 * named. Used only on read routes; user management stays isAdmin alone.
 */
export function canViewAdmin(user: { address?: string | null; sudobud?: boolean; isVerified?: boolean; frozen?: string | null } | null | undefined): boolean {
  return isAdmin(user) || (!!user && user.sudobud === true && user.isVerified === true && !user.frozen);
}

/**
 * The sysop's handle is reserved: only the ADMIN_ADDRESS account may display
 * as it. Everything that sets a display name goes through here.
 */
export function handleReservedFor(nameKey: string | null, address: string): boolean {
  if (!nameKey) return false;
  const h = adminHandle().toLowerCase();
  return h !== '' && nameKey === h && address !== adminAddress();
}

/**
 * Say at startup who the sysop is, or why nobody is.
 *
 * With ADMIN_ADDRESS unset, or set to an address no verified account holds,
 * every sysop route answers 403 and the only symptom is an empty Users app.
 * So this finds the verified account wearing the sysop handle and names the
 * address it verified with: the fix is then one line in .env. It prints to the
 * operator's own log on the operator's own box, and the address is the
 * sysop's own.
 */
export async function explainAdmin(): Promise<void> {
  const want = adminAddress();
  const holder = want
    ? await prisma.user.findFirst({ where: { address: want, isVerified: true }, select: { id: true } })
    : null;
  if (holder) { console.log('[admin] ADMIN_ADDRESS matches a verified account - sysop routes are live'); return; }
  const byHandle = await prisma.user.findFirst({
    where: { nameKey: adminHandle().toLowerCase(), isVerified: true }, select: { address: true },
  });
  const why = want ? 'ADMIN_ADDRESS matches no verified account' : 'ADMIN_ADDRESS is not set';
  console.warn(`[admin] ${why} - every sysop route will answer 403.`
    + (byHandle
      ? ` The verified "${adminHandle()}" account uses ${byHandle.address}; set ADMIN_ADDRESS to exactly that and restart.`
      : ` No verified account is named "${adminHandle()}" either.`));
}

/**
 * Rows written before `nameKey` existed have it null, and every uniqueness
 * check keys on it - so a null row's handle reads as free. Fill it once at
 * startup. Collisions (two old rows, same name in different case) are left
 * null and logged rather than guessed at.
 */
export async function backfillNameKeys(): Promise<void> {
  const rows = await prisma.user.findMany({
    where: { nameKey: null, displayName: { not: null } }, select: { id: true, displayName: true },
  });
  for (const r of rows) {
    const nameKey = r.displayName!.trim().toLowerCase();
    if (!nameKey) continue;
    try {
      await prisma.user.update({ where: { id: r.id }, data: { nameKey } });
    } catch {
      console.warn(`[admin] nameKey backfill: "${nameKey}" already held; user ${r.id} left without a key`);
    }
  }
  if (rows.length) console.log(`[admin] nameKey backfill considered ${rows.length} row(s)`);
}
