import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Set after a successful Google sign-in. */
    userId?: string;
    /** CSRF `state` for the OAuth round-trip in progress. */
    oauthState?: string;
  }
}
