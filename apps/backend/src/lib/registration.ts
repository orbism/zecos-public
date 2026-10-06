import { prisma } from './prisma';

/**
 * Whether new accounts can be created right now.
 *
 * Read on every challenge and polled by every login screen, so it is cached for
 * a few seconds; the sysop's switch clears the cache, so their own change is
 * never stale. A read that fails answers OPEN: this is a maintenance switch,
 * not a security boundary, and a database hiccup must not quietly turn away
 * every newcomer.
 */

export interface Registration {
  open: boolean;
  /** ISO time the sysop expects to reopen, when closed and they set one. */
  reopensAt: string | null;
  /** The sysop's notice while closed; null means the default maintenance line. */
  message: string | null;
}

const TTL_MS = 5_000;
let cache: { at: number; value: Registration } | null = null;

export async function getRegistration(): Promise<Registration> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const row = await prisma.registrationGate.findUnique({ where: { id: 'singleton' } });
    const value: Registration = row && !row.open
      ? { open: false, reopensAt: row.reopensAt ? row.reopensAt.toISOString() : null, message: row.message ?? null }
      : { open: true, reopensAt: null, message: null };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return { open: true, reopensAt: null, message: null };
  }
}

export const DEFAULT_CLOSED = 'New user registration is currently disabled during a maintenance window.';

/** Opening clears the date and the message: they only ever describe the current closure. */
export async function setRegistration(open: boolean, reopensAt: Date | null, message: string | null, by: string): Promise<Registration> {
  const data = { open, reopensAt: open ? null : reopensAt, message: open ? null : message, updatedBy: by };
  await prisma.registrationGate.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
  cache = null;
  return getRegistration();
}

/** The sentence the login screen shows, and the challenge refusal carries. */
export function closedMessage(r: Registration): string {
  return (r.message ?? DEFAULT_CLOSED)
    + (r.reopensAt ? ` Come back on ${new Date(r.reopensAt).toUTCString().replace(':00 GMT', ' UTC')}.` : ' Please check back soon.');
}
