import { Router } from 'express';
import { pinRateLimit } from '../middleware/pinRateLimit.js';
import { receiveByPin } from '../services/receive.js';

/** Public (no login), but every route is rate-limited per IP. */
export const receiveRouter = Router();

receiveRouter.use(pinRateLimit);
receiveRouter.use((_req, res, next) => {
  // Shared content must never be cached by browsers or proxies.
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/** GET /api/receive/:pin: `{ kind: 'text', text }`, or 404 for unknown/expired PINs. */
receiveRouter.get('/:pin', async (req, res) => {
  res.json(await receiveByPin(req.params.pin));
});
