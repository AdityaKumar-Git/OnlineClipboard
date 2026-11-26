import { Router } from 'express';
import { getHealth } from '../services/health.js';
import { errorBody } from '../lib/errors.js';

export const healthRouter = Router();

/** GET /api/health — 200 when Postgres and Redis both answer, 503 otherwise. */
healthRouter.get('/', async (_req, res) => {
  const report = await getHealth();
  if (report.ok) {
    res.json({ status: 'ok', checks: report.checks });
    return;
  }
  const failing = Object.entries(report.checks)
    .filter(([, v]) => v !== 'ok')
    .map(([k]) => k);
  res.status(503).json({
    ...errorBody('UNHEALTHY', `Unavailable: ${failing.join(', ')}`),
    checks: report.checks,
  });
});
