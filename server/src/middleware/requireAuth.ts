import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

/** Rejects requests without a signed-in session with 401. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.session.userId) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in'));
    return;
  }
  next();
};
