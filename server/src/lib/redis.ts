import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  // Fail commands fast when Redis is down instead of queueing them forever.
  maxRetriesPerRequest: 2,
  lazyConnect: false,
});

redis.on('error', (err: Error) => {
  // The URL may contain a password, so only the message is logged.
  console.error('[redis] connection error:', err.message);
});
