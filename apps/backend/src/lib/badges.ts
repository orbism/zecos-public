import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { adminAddress, adminHandle } from './admin';

/**
 * Badges: small images beside a user's name wherever it is shown in public.
 *
 * The whole set is tiny (a handful of badges, one row per holder), so it is
 * read in one go and cached; payloads carry badge KEYS only and the frontend
 * fetches the images once from GET /api/badges. Anything that changes a badge
 * or a holder calls invalidateBadges().
 */

export interface BadgeDef { key: string; title: string; tooltip: string; image: string; locked: boolean }

/** data URL, PNG/WebP/SVG: shown as <img>, where an SVG cannot run script. */
export const BADGE_IMAGE_RE = /^data:image\/(png|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
export const MAX_BADGE_IMAGE = 60_000;

const TTL_MS = 30_000;
interface Index { at: number; defs: BadgeDef[]; byUser: Map<string, string[]>; byName: Map<string, string[]> }
let cache: Index | null = null;
let loading: Promise<Index> | null = null;

async function load(): Promise<Index> {
  const [badges, links] = await Promise.all([
    prisma.badge.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.userBadge.findMany({ select: { userId: true, badgeId: true, user: { select: { nameKey: true } } } }),
  ]);
  const order = new Map(badges.map((b, i) => [b.id, i]));
  const keyOf = new Map(badges.map((b) => [b.id, b.key]));
  const byUser = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const l of [...links].sort((a, b) => (order.get(a.badgeId) ?? 0) - (order.get(b.badgeId) ?? 0))) {
    const k = keyOf.get(l.badgeId);
    if (!k) continue;
    byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), k]);
    if (l.user.nameKey) byName.set(l.user.nameKey, [...(byName.get(l.user.nameKey) ?? []), k]);
  }
  return {
    at: Date.now(), byUser, byName,
    defs: badges.map((b) => ({ key: b.key, title: b.title, tooltip: b.tooltip, image: b.imageData, locked: b.locked })),
  };
}

async function index(): Promise<Index> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  loading ??= load().then((i) => (cache = i)).finally(() => { loading = null; });
  return loading;
}

export function invalidateBadges(): void { cache = null; }

export async function badgeDefs(): Promise<BadgeDef[]> { return (await index()).defs; }

/**
 * Lookups for one response. By id where the row has one; by handle for chat
 * lines and presence, which carry the name as a string. A failed read gives
 * no badges rather than failing the page they decorate.
 */
export interface BadgeLookup { forUser: (id?: string | null) => string[]; forName: (handle?: string | null) => string[] }
export async function badgeLookup(): Promise<BadgeLookup> {
  const i = await index().catch(() => null);
  return {
    forUser: (id) => (id && i?.byUser.get(id)) || [],
    forName: (h) => (h && i?.byName.get(h.toLowerCase())) || [],
  };
}

const OG_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCAyMCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjIwIiByb2xlPSJpbWciIGFyaWEtbGFiZWw9Ik9HIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ib2ctZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMSIgeTI9IjEiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZmUyOGEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuNDUiIHN0b3AtY29sb3I9IiNmNGI3MjgiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjYzk4ZjEyIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8cmVjdCB4PSIuNzUiIHk9Ii43NSIgd2lkdGg9IjM4LjUiIGhlaWdodD0iMTguNSIgcng9IjkuMjUiIGZpbGw9InVybCgjb2ctZykiIHN0cm9rZT0iIzZiNGEwNSIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICA8cGF0aCBkPSJNNSA0LjJoMzAiIHN0cm9rZT0iI2ZmZjZkNiIgc3Ryb2tlLW9wYWNpdHk9Ii41NSIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8ZyBmaWxsPSJub25lIiBzdHJva2U9IiMxYTEyMDAiIHN0cm9rZS13aWR0aD0iMi40IiBzdHJva2UtbGluZWNhcD0icm91bmQiPgogICAgPGNpcmNsZSBjeD0iMTQuMiIgY3k9IjEwIiByPSI0LjQiLz4KICAgIDxwYXRoIGQ9Ik0yOS4zIDYuOUE0LjQgNC40IDAgMSAwIDMwLjIgMTAuNEgyNi42Ii8+CiAgPC9nPgo8L3N2Zz4K';

/**
 * One-time OG grant: every verified account that exists when this first runs,
 * except the sysop. Runs at boot and does nothing once the badge exists. The
 * badge is locked (never deletable), so the grant can never run a second time
 * and reach accounts made after registrations reopen.
 */
export async function seedOgBadge(log: (m: string) => void = () => {}): Promise<void> {
  await seedBadge({ title: 'OG', key: 'og', tooltip: 'legacy user | early beta tester', imageData: OG_IMAGE }, async () => {
    const sysopAddr = adminAddress();
    const sysopName = adminHandle().toLowerCase();
    const users = await prisma.user.findMany({ where: { isVerified: true }, select: { id: true, address: true, nameKey: true } });
    return users.filter((u) => u.address !== sysopAddr && (!sysopName || u.nameKey !== sysopName)).map((u) => u.id);
  }, log);
}

const ZECHUB_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NiAyMCIgd2lkdGg9IjY2IiBoZWlnaHQ9IjIwIiByb2xlPSJpbWciIGFyaWEtbGFiZWw9IlplY0h1YiI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9InpoLWciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjYjhmZmU4Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iLjQ1IiBzdG9wLWNvbG9yPSIjM2ZjZmE5Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzFlOGY3MyIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPHJlY3QgeD0iLjc1IiB5PSIuNzUiIHdpZHRoPSI2NC41IiBoZWlnaHQ9IjE4LjUiIHJ4PSI5LjI1IiBmaWxsPSJ1cmwoI3poLWcpIiBzdHJva2U9IiMwYjRhM2EiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgPHBhdGggZD0iTTYgNC4yaDU0IiBzdHJva2U9IiNlZmZmZjkiIHN0cm9rZS1vcGFjaXR5PSIuNTUiIHN0cm9rZS13aWR0aD0iMSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CiAgPGcgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDQyNDFjIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+CiAgICA8cGF0aCBkPSJNNyA1LjVIMTNMNyAxNC41SDEzIi8+CiAgICA8cGF0aCBkPSJNMjIgNS41SDE2LjVWMTQuNUgyMk0xNi41IDEwSDIxIi8+CiAgICA8cGF0aCBkPSJNMzEgNS41SDI1LjVWMTQuNUgzMSIvPgogICAgPHBhdGggZD0iTTM0LjUgNS41VjE0LjVNNDAuNSA1LjVWMTQuNU0zNC41IDEwSDQwLjUiLz4KICAgIDxwYXRoIGQ9Ik00NCA1LjVWMTJRNDQgMTQuNSA0Ni43NSAxNC41UTQ5LjUgMTQuNSA0OS41IDEyVjUuNSIvPgogICAgPHBhdGggZD0iTTUzIDUuNVYxNC41SDU3UTU5LjUgMTQuNSA1OS41IDEyLjI1UTU5LjUgMTAgNTcgMTBINTNNNTMgNS41SDU2LjVRNTguNzUgNS41IDU4Ljc1IDcuNzVRNTguNzUgMTAgNTYuNSAxMCIvPgogIDwvZz4KPC9zdmc+Cg==';

/** One-time ZecHub grant to the accounts named dismad and zechub (same rules as OG). */
export async function seedZechubBadge(log: (m: string) => void = () => {}): Promise<void> {
  await seedBadge({ title: 'ZecHub', key: 'zechub', tooltip: "ZecHub | Zcash's community education hub", imageData: ZECHUB_IMAGE }, async () =>
    (await prisma.user.findMany({ where: { nameKey: { in: ['dismad', 'zechub'] } }, select: { id: true } })).map((u) => u.id), log);
}

/** Creates a locked badge with its first holders, once: a no-op when the key exists. */
async function seedBadge(
  def: { title: string; key: string; tooltip: string; imageData: string },
  holders: () => Promise<string[]>,
  log: (m: string) => void,
): Promise<void> {
  if (await prisma.badge.findUnique({ where: { key: def.key }, select: { id: true } })) return;
  const ids = await holders();
  try {
    await prisma.badge.create({ data: { ...def, locked: true, holders: { create: ids.map((userId) => ({ userId })) } } });
    invalidateBadges();
    log(`${def.title} badge created and granted to ${ids.length} account(s)`);
  } catch (e) {
    // Another process seeded it first.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
  }
}

export interface PublicOwner { name: string; badges: string[] }

/**
 * The accounts, among these owners, that chose to show their name on their
 * Pools (User.showOwnerName). Everyone else stays anonymous: absent from the map.
 */
export async function publicOwners(ownerIds: (string | null | undefined)[]): Promise<Map<string, PublicOwner>> {
  const ids = [...new Set(ownerIds.filter((x): x is string => Boolean(x)))];
  if (!ids.length) return new Map();
  const [users, bl] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids }, showOwnerName: true, isVerified: true, displayName: { not: null }, frozen: null },
      select: { id: true, displayName: true },
    }),
    badgeLookup(),
  ]);
  return new Map(users.map((u) => [u.id, { name: u.displayName!, badges: bl.forUser(u.id) }]));
}
