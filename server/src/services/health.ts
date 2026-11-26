import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

export type CheckResult = 'ok' | 'error';

export interface HealthReport {
  ok: boolean;
  checks: { db: CheckResult; redis: CheckResult };
}

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runCheck(name: string, fn: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await withTimeout(fn(), CHECK_TIMEOUT_MS);
    return 'ok';
  } catch (err) {
    console.error(`[health] ${name} check failed:`, err instanceof Error ? err.message : err);
    return 'error';
  }
}

export async function checkDb(): Promise<CheckResult> {
  return runCheck('db', () => prisma.$queryRaw`SELECT 1`);
}

export async function checkRedis(): Promise<CheckResult> {
  return runCheck('redis', async () => {
    const reply = await redis.ping();
    if (reply !== 'PONG') throw new Error(`unexpected PING reply: ${reply}`);
  });
}

export async function getHealth(): Promise<HealthReport> {
  const [db, redisStatus] = await Promise.all([checkDb(), checkRedis()]);
  return { ok: db === 'ok' && redisStatus === 'ok', checks: { db, redis: redisStatus } };
}
