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
