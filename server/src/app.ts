import express from 'express';
import { healthRouter } from './routes/health.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  app.use('/api/health', healthRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
