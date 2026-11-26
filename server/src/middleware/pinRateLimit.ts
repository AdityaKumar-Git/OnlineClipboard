import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { hitPinRateLimit } from '../services/rateLimit.js';

/** Per-IP limit on PIN lookups. Mounted on every /api/receive route. */
export const pinRateLimit: RequestHandler = async (req, res, next) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const { allowed, retryAfterSeconds } = await hitPinRateLimit(ip);
  if (allowed) return next();

  res.setHeader('Retry-After', String(retryAfterSeconds));
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  next(
    new AppError(
      429,
      'RATE_LIMITED',
      `Too many PIN attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    ),
  );
};
