import { randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { createOAuthClient } from '../lib/google.js';

/** Sign-in needs identity only. Drive (`drive.file`) is requested separately, later. */
export const SIGN_IN_SCOPES = ['openid', 'email', 'profile'];

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
}

export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function stateMatches(expected: string | undefined, actual: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getSignInUrl(state: string): string {
  return createOAuthClient(env.GOOGLE_REDIRECT_URI).generateAuthUrl({
    access_type: 'online',
    scope: SIGN_IN_SCOPES,
    state,
    prompt: 'select_account',
  });
}

/**
 * Exchanges the callback code and verifies the ID token. Only the identity is kept;
 * sign-in tokens are discarded (no refresh token is stored for sign-in).
 */
export async function verifySignInCode(code: string): Promise<GoogleIdentity> {
  const client = createOAuthClient(env.GOOGLE_REDIRECT_URI);
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new AppError(502, 'GOOGLE_NO_ID_TOKEN', 'Google did not return an ID token');

  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new AppError(502, 'GOOGLE_BAD_ID_TOKEN', 'Google ID token is missing the account details');
  }
  if (payload.email_verified === false) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Your Google email address is not verified');
  }
  return { sub: payload.sub, email: payload.email, name: payload.name ?? null };
}

// ---------------------------------------------------------------------------
// Drive connection (incremental authorization). Scope is drive.file ONLY.
// ---------------------------------------------------------------------------

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** `openid` makes Google return an ID token so we can check it's the signed-in account. */
export const DRIVE_SCOPES = ['openid', DRIVE_FILE_SCOPE];

export interface DriveGrant {
  /** Google account that granted access (from the ID token). */
  sub: string;
  refreshToken: string | null;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresInSeconds: number;
  scopes: string[];
}

export function getDriveConnectUrl(state: string, loginHint?: string): string {
  return createOAuthClient(env.GOOGLE_DRIVE_REDIRECT_URI).generateAuthUrl({
    access_type: 'offline',
    // Forces a new refresh token on every (re)connect.
    prompt: 'consent',
    include_granted_scopes: true,
    scope: DRIVE_SCOPES,
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
}

function secondsUntil(expiryDateMs: number | null | undefined, fallback = 3600): number {
  return expiryDateMs ? Math.floor((expiryDateMs - Date.now()) / 1000) : fallback;
}

export async function exchangeDriveCode(code: string): Promise<DriveGrant> {
  const client = createOAuthClient(env.GOOGLE_DRIVE_REDIRECT_URI);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token)
    throw new AppError(502, 'GOOGLE_NO_ACCESS_TOKEN', 'Google did not return a token');
  if (!tokens.id_token) throw new AppError(502, 'GOOGLE_NO_ID_TOKEN', 'Google did not return an ID token');

  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
  const sub = ticket.getPayload()?.sub;
  if (!sub) throw new AppError(502, 'GOOGLE_BAD_ID_TOKEN', 'Google ID token is missing the account id');

  return {
    sub,
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token,
    expiresInSeconds: secondsUntil(tokens.expiry_date),
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
  };
}

/** Exchanges a refresh token for a fresh access token. Throws Google's error (e.g. invalid_grant). */
export async function refreshDriveAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const client = createOAuthClient(env.GOOGLE_DRIVE_REDIRECT_URI);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new AppError(502, 'GOOGLE_NO_ACCESS_TOKEN', 'Google did not return an access token');
  return { accessToken: token, expiresInSeconds: secondsUntil(client.credentials.expiry_date) };
}

/** Revokes a token at Google. Revoking a refresh token also revokes its access tokens. */
export async function revokeGoogleToken(token: string): Promise<void> {
  await createOAuthClient(env.GOOGLE_DRIVE_REDIRECT_URI).revokeToken(token);
}

/** True when Google says the refresh token is expired or revoked. */
export function isInvalidGrant(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { message?: unknown; response?: { data?: { error?: unknown } } };
  return e.response?.data?.error === 'invalid_grant' || e.message === 'invalid_grant';
}
