import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { driveFor, googleErrorStatus, isDriveApiDisabled } from '../lib/google.js';
import { prisma } from '../lib/prisma.js';
import { decrypt, encrypt } from './crypto.js';
import { DRIVE_FILE_SCOPE, revokeGoogleToken, type DriveGrant } from './googleAuth.js';
import { cacheAccessToken, clearCachedAccessToken } from './tokens.js';

export const APP_FOLDER_NAME = 'Online Clipboard';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the id of the user's app folder, creating it if there is none or the saved one is
 * gone (deleted or trashed). Folders are tracked by id, never looked up by name.
 */
export async function ensureAppFolder(accessToken: string, folderId: string | null): Promise<string> {
  try {
    return await findOrCreateAppFolder(accessToken, folderId);
  } catch (err) {
    if (isDriveApiDisabled(err)) {
      throw new AppError(
        503,
        'DRIVE_API_DISABLED',
        'The Google Drive API is not enabled for this app’s Google Cloud project',
      );
    }
    throw err;
  }
}

async function findOrCreateAppFolder(accessToken: string, folderId: string | null): Promise<string> {
  const drive = driveFor(accessToken);

  if (folderId) {
    try {
      const { data } = await drive.files.get({ fileId: folderId, fields: 'id, trashed, mimeType' });
      if (data.id && !data.trashed && data.mimeType === FOLDER_MIME) return data.id;
    } catch (err) {
      if (googleErrorStatus(err) !== 404) throw err;
    }
  }

  const { data } = await drive.files.create({
    requestBody: { name: APP_FOLDER_NAME, mimeType: FOLDER_MIME },
    fields: 'id',
  });
  if (!data.id) throw new AppError(502, 'DRIVE_FOLDER_FAILED', 'Could not create the Drive folder');
  return data.id;
}

/** `now + DRIVE_REFRESH_TOKEN_TTL_DAYS`, or null when unset (production mode: no known expiry). */
export function driveTokenExpiry(now = new Date()): Date | null {
  const days = env.DRIVE_REFRESH_TOKEN_TTL_DAYS;
  return days ? new Date(now.getTime() + days * DAY_MS) : null;
}

/** Best-effort revoke, used when a grant has to be thrown away. */
async function revokeQuietly(token: string | null) {
  if (!token) return;
  await revokeGoogleToken(token).catch(() => {});
}

/**
 * Stores a Drive grant for the signed-in user: checks it's the same Google account and that
 * drive.file was granted, encrypts the refresh token, and creates/verifies the app folder.
 */
export async function connectDrive(userId: string, grant: DriveGrant): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleSub: true, driveFolderId: true },
  });
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');

  if (grant.sub !== user.googleSub) {
    await revokeQuietly(grant.refreshToken ?? grant.accessToken);
    throw new AppError(403, 'DRIVE_ACCOUNT_MISMATCH', 'Connect the same Google account you signed in with');
  }
  if (!grant.scopes.includes(DRIVE_FILE_SCOPE)) {
    await revokeQuietly(grant.refreshToken ?? grant.accessToken);
    throw new AppError(403, 'DRIVE_SCOPE_MISSING', 'Allow access to Google Drive files to share files');
  }
  if (!grant.refreshToken) {
    throw new AppError(502, 'NO_REFRESH_TOKEN', 'Google did not return a refresh token. Please try again.');
  }

  const folderId = await ensureAppFolder(grant.accessToken, user.driveFolderId);
  const now = new Date();

  await prisma.user.update({
    where: { id: userId },
    data: {
      driveConnected: true,
      driveRefreshTokenEnc: encrypt(grant.refreshToken),
      driveFolderId: folderId,
      driveConnectedAt: now,
      driveTokenExpiresAt: driveTokenExpiry(now),
    },
  });
  await cacheAccessToken(userId, grant.accessToken, grant.expiresInSeconds);
}

/** Revokes the token at Google (errors ignored: it may already be dead) and forgets it. */
export async function disconnectDrive(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { driveRefreshTokenEnc: true },
  });
  if (user?.driveRefreshTokenEnc) {
    let refreshToken: string | null = null;
    try {
      refreshToken = decrypt(user.driveRefreshTokenEnc);
    } catch {
      // Undecryptable (e.g. key rotated): nothing to revoke, just clear it.
    }
    await revokeQuietly(refreshToken);
  }

  await prisma.user.update({
    where: { id: userId },
    // The folder id is kept: the folder stays in the user's Drive and is re-verified on reconnect.
    data: { driveConnected: false, driveRefreshTokenEnc: null, driveTokenExpiresAt: null },
  });
  await clearCachedAccessToken(userId);
}
