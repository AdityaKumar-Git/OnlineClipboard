import { google } from 'googleapis';
import { env } from '../config/env.js';

/** A fresh OAuth2 client for the given redirect URI. Never shared between users. */
export function createOAuthClient(redirectUri: string) {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

export type OAuthClient = ReturnType<typeof createOAuthClient>;

/** Drive v3 client acting with one user's access token. */
export function driveFor(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: 'v3', auth });
}

export type DriveClient = ReturnType<typeof driveFor>;

/** Status code of a googleapis (gaxios) error, if any. */
export function googleErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  for (const v of [e.response?.status, e.status, e.code]) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d{3}$/.test(v)) return Number(v);
  }
  return undefined;
}
