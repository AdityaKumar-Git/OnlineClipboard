import express from 'express';
import type { Store } from 'express-session';
import { env } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
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
  app.use(express.json({ limit: '200kb' }));

  app.use('/api/health', healthRouter);

  app.use(sessionMiddleware(options.sessionStore ?? createRedisSessionStore()));
  app.use('/auth', authRouter);
  app.use('/api/me', meRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
