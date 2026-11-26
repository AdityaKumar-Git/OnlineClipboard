import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { createShareBody, createTextShare } from '../services/shares.js';

export const sharesRouter = Router();

sharesRouter.use(requireAuth);

/** POST /api/shares: create a share and its PIN. Returns `{ id, pin, pinExpiresAt }`. */
sharesRouter.post('/', async (req, res) => {
  const body = createShareBody.parse(req.body);
  const created = await createTextShare(req.session.userId!, body);
  res.status(201).json(created);
});
