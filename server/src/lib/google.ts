import { google } from 'googleapis';
import { env } from '../config/env.js';

/** A fresh OAuth2 client for the given redirect URI. Never shared between users. */
export function createOAuthClient(redirectUri: string) {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

export type OAuthClient = ReturnType<typeof createOAuthClient>;
