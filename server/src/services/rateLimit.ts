import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';

export const PIN_RATE_WINDOW_SECONDS = 10 * 60;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (only meaningful when blocked). */
  retryAfterSeconds: number;
}

/** Counts one PIN lookup for this IP in `rl:pin:{ip}` (fixed 10-minute window). */
export async function hitPinRateLimit(ip: string): Promise<RateLimitResult> {
  const key = `rl:pin:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, PIN_RATE_WINDOW_SECONDS);
  if (count <= env.PIN_RATE_LIMIT) return { allowed: true, retryAfterSeconds: 0 };

  let ttl = await redis.ttl(key);
  if (ttl < 0) {
    // The EXPIRE after the first INCR was lost; never let a counter live forever.
    await redis.expire(key, PIN_RATE_WINDOW_SECONDS);
    ttl = PIN_RATE_WINDOW_SECONDS;
  }
  return { allowed: false, retryAfterSeconds: ttl };
}
