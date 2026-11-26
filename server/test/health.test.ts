import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { queryRaw, ping } = vi.hoisted(() => ({ queryRaw: vi.fn(), ping: vi.fn() }));

vi.mock('../src/lib/prisma.js', () => ({ prisma: { $queryRaw: queryRaw } }));
vi.mock('../src/lib/redis.js', () => ({ redis: { ping } }));

const { createApp } = await import('../src/app.js');

describe('GET /api/health', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    ping.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 200 when Postgres and Redis are up', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    ping.mockResolvedValue('PONG');

    const res = await request(createApp()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
  });

  it('returns 503 with the error shape when the database is down', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused'));
    ping.mockResolvedValue('PONG');

    const res = await request(createApp()).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: 'UNHEALTHY', message: 'Unavailable: db' });
    expect(res.body.checks).toEqual({ db: 'error', redis: 'ok' });
  });

  it('returns 503 when Redis is down', async () => {
    queryRaw.mockResolvedValue([]);
    ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await request(createApp()).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ db: 'ok', redis: 'error' });
  });
});

describe('unknown routes', () => {
  it('return 404 with the error shape', async () => {
    const res = await request(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});
