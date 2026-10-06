import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { allowedNetworks, laneStats } from '../wallet/zallet';
import { lastKnownWalletLag, maxTrustedLagBlocks } from '../wallet/rpc';

/**
 * GET /api/health - is this backend actually able to serve, not just listening?
 *
 * One cheap read per model group, each with its own time limit, all at once.
 * 200 when every group answers, 503 when any does not, with which one and why,
 * so a deployer's health check can tell "port open" from "database reachable
 * and the tables it needs are there". Reads only, no secrets in the answer.
 */
const LIMIT_MS = 3000;

const CHECKS: Record<string, () => Promise<unknown>> = {
  accounts: () => prisma.user.findFirst({ select: { id: true } }),
  payments: () => prisma.paymentClaim.findFirst({ select: { id: true } }),
};

async function timed(run: () => Promise<unknown>): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${LIMIT_MS}ms`)), LIMIT_MS); }),
    ]);
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    // Prisma messages open with blank lines and end with the actual reason, so
    // report the last non-empty line, with its error code when it has one.
    const lines = (e instanceof Error ? e.message : String(e)).split('\n').map((l) => l.trim()).filter(Boolean);
    const code = (e as { code?: unknown })?.code;
    const why = (lines[lines.length - 1] ?? 'unknown error').slice(0, 200);
    return { ok: false, ms: Date.now() - t0, error: typeof code === 'string' ? `${code}: ${why}` : why };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/*
 * Beyond "can it serve" (audit H4): each wallet's scan lag and spend-lane age,
 * from memory (no wallet call), and money rows that have waited too long. They
 * do NOT change the status code - a slow wallet is not a reason for a
 * deployer's check to restart the server - they fill `degraded` with reasons.
 */
const STUCK = {
  // Paid for, code not yet delivered.
  authFunded: () => prisma.authChallenge.count({ where: { status: 'funded', createdAt: { lt: ago(30) } } }),
  // An operator refund whose send failed: needs a human.
  authRefunding: () => prisma.authChallenge.count({ where: { status: 'refunding' } }),
};
function ago(minutes: number): Date { return new Date(Date.now() - minutes * 60_000); }

export async function healthRoutes(server: FastifyInstance) {
  server.get('/', async (_req, reply) => {
    const names = Object.keys(CHECKS);
    const results = await Promise.all(names.map((n) => timed(CHECKS[n]!)));
    const checks = Object.fromEntries(names.map((n, i) => [n, results[i]]));
    const ok = results.every((r) => r.ok);
    const degraded: string[] = [];

    const wallets = Object.fromEntries(allowedNetworks().map((net) => {
      const lag = lastKnownWalletLag(net);
      const lane = laneStats(net);
      const lagAgeS = lag ? Math.round((Date.now() - lag.at) / 1000) : null;
      if (lag && lag.lag !== null && lag.lag > maxTrustedLagBlocks()) degraded.push(`${net} wallet is ${lag.lag} blocks behind`);
      if (lane.oldestMs > 60_000) degraded.push(`${net} spend lane has a job waiting ${Math.round(lane.oldestMs / 1000)}s`);
      return [net, { lagBlocks: lag?.lag ?? null, lagCheckedSecondsAgo: lagAgeS, laneDepth: lane.depth, laneOldestSeconds: Math.round(lane.oldestMs / 1000) }];
    }));

    let stuck: Record<string, number | null> = {};
    if (ok) {
      const keys = Object.keys(STUCK) as (keyof typeof STUCK)[];
      const counts = await Promise.all(keys.map((k) => STUCK[k]().catch(() => null)));
      stuck = Object.fromEntries(keys.map((k, i) => [k, counts[i] ?? null]));
      for (const [k, n] of Object.entries(stuck)) if (n) degraded.push(`${n} ${k}`);
    }
    return reply.code(ok ? 200 : 503).send({ ok, checks, wallets, stuck, degraded, at: new Date().toISOString() });
  });
}
