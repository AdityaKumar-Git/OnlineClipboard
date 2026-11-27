import { AppError } from '../lib/errors.js';
import { describeGoogleError } from '../lib/google.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { decrypt } from './crypto.js';
import { isInvalidGrant, refreshDriveAccessToken } from './googleAuth.js';

/** Access tokens are cached for their lifetime minus this margin. */
const EXPIRY_MARGIN_SECONDS = 60;

export const gtokenKey = (userId: string) => `gtoken:${userId}`;

export const driveNotConnected = (message = 'Connect Google Drive to share files') =>
  new AppError(409, 'DRIVE_NOT_CONNECTED', message);

export async function cacheAccessToken(userId: string, accessToken: string, expiresInSeconds: number) {
  const ttl = expiresInSeconds - EXPIRY_MARGIN_SECONDS;
  if (ttl > 0) await redis.set(gtokenKey(userId), accessToken, 'EX', ttl);
}

export async function clearCachedAccessToken(userId: string) {
  await redis.del(gtokenKey(userId));
}

/** Google said the refresh token is dead: forget it so the UI asks the user to reconnect. */
export async function markDriveDisconnected(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { driveConnected: false, driveRefreshTokenEnc: null, driveTokenExpiresAt: null },
  });
  await clearCachedAccessToken(userId);
}

/**
 * A valid Drive access token for the user: from the Redis cache, or refreshed with the
 * stored (encrypted) refresh token. Throws 409 DRIVE_NOT_CONNECTED if there is no usable token.
 */
export async function getAccessToken(userId: string): Promise<string> {
  const cached = await redis.get(gtokenKey(userId));
  if (cached) return cached;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { driveConnected: true, driveRefreshTokenEnc: true },
  });
  if (!user?.driveConnected || !user.driveRefreshTokenEnc) throw driveNotConnected();

  let refreshed: { accessToken: string; expiresInSeconds: number };
  try {
    refreshed = await refreshDriveAccessToken(decrypt(user.driveRefreshTokenEnc));
  } catch (err) {
    if (isInvalidGrant(err)) {
      await markDriveDisconnected(userId);
      throw driveNotConnected('Your Google Drive connection has expired. Please reconnect Google Drive.');
    }
    if (err instanceof AppError) throw err;
    // Never log the error object: it can carry the token request.
    console.error('[tokens] access token refresh failed:', describeGoogleError(err));
    throw new AppError(502, 'GOOGLE_UNAVAILABLE', 'Could not reach Google Drive. Please try again.');
  }

  await cacheAccessToken(userId, refreshed.accessToken, refreshed.expiresInSeconds);
  return refreshed.accessToken;
}
