import { Router } from 'express';
import { AppError } from '../lib/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { destroySession } from '../middleware/session.js';
import { getMe } from '../services/users.js';

export const meRouter = Router();

/** GET /api/me: the signed-in user. */
meRouter.get('/', requireAuth, async (req, res) => {
  const me = await getMe(req.session.userId!);
  if (!me) {
    // The user row is gone (e.g. deleted); drop the stale session.
    await destroySession(req);
    throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  }
  res.json(me);
});
