import { Router } from 'express';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { disconnectDrive } from '../services/drive.js';
import { driveNotConnected, getAccessToken } from '../services/tokens.js';

export const driveRouter = Router();

driveRouter.use(requireAuth);
driveRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/**
 * GET /api/drive/token: `{ accessToken, folderId }` for a direct browser upload to the
 * signed-in user's own Drive. Never returns the refresh token.
 */
driveRouter.get('/token', async (req, res) => {
  const userId = req.session.userId!;
  const accessToken = await getAccessToken(userId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { driveFolderId: true } });
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  if (!user.driveFolderId) throw driveNotConnected();
  res.json({ accessToken, folderId: user.driveFolderId });
});

/** POST /api/drive/disconnect: revoke the token at Google and clear it. */
driveRouter.post('/disconnect', async (req, res) => {
  await disconnectDrive(req.session.userId!);
  res.status(204).end();
});
