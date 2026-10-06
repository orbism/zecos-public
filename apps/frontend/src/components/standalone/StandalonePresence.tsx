'use client';

import { SessionGuard } from '@/components/SessionGuard/SessionGuard';
import { GuestPresence } from '@/components/GuestPresence/GuestPresence';

/**
 * Presence heartbeat for the standalone routes.
 *
 * Both of these used to be mounted only by the desktop page, so once traffic
 * moved to `/<app-id>` nobody was checking in: guests never registered with the
 * backend (leaving the sysop guest list empty) and logged-in sessions never
 * refreshed `lastSeenAt`/`lastIp` (leaving the roster showing month-old
 * entries with no IP). Mounting them here puts standalone visitors back on the
 * radar - and gives the sysop a wire to standalone guests too.
 *
 * Neither renders anything until it has something to say.
 */
export function StandalonePresence() {
  return (
    <>
      <SessionGuard />
      <GuestPresence />
    </>
  );
}
