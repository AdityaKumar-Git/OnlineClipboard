import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, errorBody } from '../lib/errors.js';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json(errorBody('NOT_FOUND', 'Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json(errorBody(err.code, err.message));
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    res.status(400).json(errorBody('VALIDATION_ERROR', message));
    return;
  }
  // Malformed JSON bodies from express.json()
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json(errorBody('INVALID_JSON', 'Request body is not valid JSON'));
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Request body is too large'));
    return;
  }
  console.error('[error] unhandled:', err instanceof Error ? err.message : err);
  res.status(500).json(errorBody('INTERNAL', 'Something went wrong'));
};
