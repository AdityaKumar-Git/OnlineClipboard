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

interface GoogleErrorBody {
  error?:
    | string
    | { status?: string; message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
  error_description?: string;
}

/** Google's machine-readable reason (e.g. `invalid_grant`, `accessNotConfigured`), if any. */
export function googleErrorReason(err: unknown): string | undefined {
  const data = (err as { response?: { data?: GoogleErrorBody } } | null)?.response?.data;
  if (!data?.error) return undefined;
  if (typeof data.error === 'string') return data.error;
  return data.error.errors?.[0]?.reason ?? data.error.details?.[0]?.reason ?? data.error.status;
}

/**
 * One safe log line for a googleapis error: status, reason and message only.
 * Never log the error object itself: its `config` holds the request, which can include tokens.
 */
export function describeGoogleError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  const status = googleErrorStatus(err);
  const reason = googleErrorReason(err);
  const parts = [
    status && `status=${status}`,
    reason && `reason=${reason}`,
    `message=${err.message.slice(0, 300)}`,
  ];
  return parts.filter(Boolean).join(' ');
}

/** The Drive API is not enabled for the Google Cloud project that owns the OAuth client. */
export function isDriveApiDisabled(err: unknown): boolean {
  const reason = googleErrorReason(err);
  return (
    googleErrorStatus(err) === 403 &&
    (reason === 'accessNotConfigured' ||
      reason === 'SERVICE_DISABLED' ||
      (err instanceof Error && /has not been used in project|is disabled/i.test(err.message)))
  );
}
