import { PrismaClient } from '@prisma/client';

/*
 * The market's money columns are BIGINT (round 103: a 32-bit int capped a
 * price at 21.47 ZEC). Every amount the code handles is a whole number of
 * zatoshi far below 2^53 (the whole ZEC supply is 2.1e15), so reads are turned
 * back into plain numbers here, once, rather than threading bigint through
 * every sum and comparison in the money path. Writes take numbers as they
 * are. Database-side sums (aggregate/groupBy) still come back as bigint and
 * are converted where they are read.
 */
const num = <K extends string>(field: K) => ({ needs: { [field]: true } as Record<K, true>, compute: (r: Record<K, bigint>) => Number(r[field]) });
const numOrNull = <K extends string>(field: K) => ({ needs: { [field]: true } as Record<K, true>, compute: (r: Record<K, bigint | null>) => (r[field] === null ? null : Number(r[field])) });

function client() {
  return new PrismaClient().$extends({
    result: {
    },
  });
}

type Client = ReturnType<typeof client>;
const globalForPrisma = globalThis as unknown as { prisma?: Client };
export const prisma = globalForPrisma.prisma ?? client();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** The transaction client handed to prisma.$transaction(async (tx) => ...). */
export type Tx = Parameters<Extract<Parameters<typeof prisma.$transaction>[0], (...a: never[]) => unknown>>[0];
