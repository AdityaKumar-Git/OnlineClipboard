import express from 'express';
import type { Store } from 'express-session';
import { env } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { sharesRouter } from './routes/shares.js';
import { receiveRouter } from './routes/receive.js';
import { errorHandler, notFound } from './middleware/error.js';
import { createRedisSessionStore, sessionMiddleware } from './middleware/session.js';

export interface AppOptions {
  /** Defaults to the Redis store; tests pass a MemoryStore. */
  sessionStore?: Store;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a TLS-terminating proxy in production, so secure cookies work.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  // Room for MAX_TEXT_KB of text even when JSON escaping inflates it; the exact limit is
  // enforced on the decoded text in the shares service.
  app.use(express.json({ limit: `${env.MAX_TEXT_KB * 6 + 16}kb` }));

  app.use('/api/health', healthRouter);
  // No session needed to receive.
  app.use('/api/receive', receiveRouter);

  app.use(sessionMiddleware(options.sessionStore ?? createRedisSessionStore()));
  app.use('/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/shares', sharesRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
