import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import {
  createOAuthState,
  exchangeDriveCode,
  getDriveConnectUrl,
  getSignInUrl,
  stateMatches,
  verifySignInCode,
} from '../services/googleAuth.js';
import { connectDrive } from '../services/drive.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { describeGoogleError } from '../lib/google.js';
import { upsertUserFromGoogle } from '../services/users.js';
import { SESSION_COOKIE, destroySession, regenerateSession, saveSession } from '../middleware/session.js';

export const authRouter = Router();

const callbackQuery = z.union([
  z.object({ code: z.string().min(1), state: z.string().min(1) }),
  z.object({ error: z.string().min(1) }),
]);

/** Where the browser lands after the OAuth round-trip. `error` is shown by the Login page. */
function webRedirect(path: string, error?: string) {
  const url = new URL(path, env.WEB_ORIGIN);
  if (error) url.searchParams.set('error', error);
  return url.toString();
}

/** GET /auth/google: start sign-in. */
authRouter.get('/google', async (req, res) => {
  const state = createOAuthState();
  req.session.oauthState = state;
  await saveSession(req);
  res.redirect(getSignInUrl(state));
});

/** GET /auth/google/callback: verify state, exchange the code, upsert the user, start the session. */
authRouter.get('/google/callback', async (req, res) => {
  const parsed = callbackQuery.safeParse(req.query);
  const expectedState = req.session.oauthState;
  delete req.session.oauthState;

  if (!parsed.success) return res.redirect(webRedirect('/login', 'signin_failed'));
  if ('error' in parsed.data) return res.redirect(webRedirect('/login', 'access_denied'));
  if (!stateMatches(expectedState, parsed.data.state)) {
    return res.redirect(webRedirect('/login', 'state_mismatch'));
  }

  try {
    const identity = await verifySignInCode(parsed.data.code);
    const user = await upsertUserFromGoogle(identity);
    // New session id on login prevents session fixation.
    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    return res.redirect(webRedirect('/'));
  } catch (err) {
    console.error('[auth] sign-in failed:', describeGoogleError(err));
    return res.redirect(webRedirect('/login', 'signin_failed'));
  }
});

/** GET /auth/google/drive: connect or reconnect Drive (drive.file only). Needs a signed-in user. */
authRouter.get('/google/drive', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect(webRedirect('/login'));
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return res.redirect(webRedirect('/login'));

  const state = createOAuthState();
  req.session.driveOauthState = state;
  await saveSession(req);
  res.redirect(getDriveConnectUrl(state, user.email));
});

/** Drive-connect errors land on the Send page as `?drive_error=<code>`. */
function driveRedirect(error?: string) {
  const url = new URL('/', env.WEB_ORIGIN);
  url.searchParams.set(error ? 'drive_error' : 'drive', error ?? 'connected');
  return url.toString();
}

/** GET /auth/google/drive/callback: store the encrypted refresh token and set up the app folder. */
authRouter.get('/google/drive/callback', async (req, res) => {
  const parsed = callbackQuery.safeParse(req.query);
  const expectedState = req.session.driveOauthState;
  delete req.session.driveOauthState;
  const userId = req.session.userId;

  if (!userId) return res.redirect(webRedirect('/login'));
  if (!parsed.success) return res.redirect(driveRedirect('connect_failed'));
  if ('error' in parsed.data) {
    await saveSession(req);
    return res.redirect(driveRedirect('access_denied'));
  }
  if (!stateMatches(expectedState, parsed.data.state)) {
    await saveSession(req);
    return res.redirect(driveRedirect('state_mismatch'));
  }

  try {
    const grant = await exchangeDriveCode(parsed.data.code);
    await connectDrive(userId, grant);
    await saveSession(req);
    return res.redirect(driveRedirect());
  } catch (err) {
    const code = err instanceof AppError ? err.code.toLowerCase() : 'connect_failed';
    // Status/reason/message only: googleapis errors carry the request (and tokens) in `config`.
    console.error(`[auth] drive connect failed (${code}):`, describeGoogleError(err));
    await saveSession(req).catch(() => {});
    return res.redirect(driveRedirect(code));
  }
});

/** POST /auth/logout: destroy the session and clear the cookie. */
authRouter.post('/logout', async (req, res) => {
  await destroySession(req);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production' });
  res.status(204).end();
});
