import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { createOAuthState, getSignInUrl, stateMatches, verifySignInCode } from '../services/googleAuth.js';
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
    console.error('[auth] sign-in failed:', err instanceof Error ? err.message : 'unknown error');
    return res.redirect(webRedirect('/login', 'signin_failed'));
  }
});

/** POST /auth/logout: destroy the session and clear the cookie. */
authRouter.post('/logout', async (req, res) => {
  await destroySession(req);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production' });
  res.status(204).end();
});
