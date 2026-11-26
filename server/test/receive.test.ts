import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import session from 'express-session';
import type { FakeRedis } from './helpers/fakeRedis.js';

const m = vi.hoisted(() => ({ redis: null as unknown as FakeRedis, findUnique: vi.fn() }));

vi.mock('../src/lib/redis.js', async () => {
  const { FakeRedis } = await import('./helpers/fakeRedis.js');
  m.redis = new FakeRedis();
  return { redis: m.redis };
});
vi.mock('../src/lib/prisma.js', () => ({ prisma: { share: { findUnique: m.findUnique } } }));

const { createApp } = await import('../src/app.js');
const { reservePin } = await import('../src/services/pin.js');
const { hitPinRateLimit, PIN_RATE_WINDOW_SECONDS } = await import('../src/services/rateLimit.js');

const app = () => request(createApp({ sessionStore: new session.MemoryStore() }));
const textShare = (text: string) => ({ kind: 'TEXT', status: 'ACTIVE', textContent: text });

describe('GET /api/receive/:pin (text)', () => {
  beforeEach(() => m.redis.flush());
  afterEach(() => vi.resetAllMocks());

  it('returns the text for an active PIN, without needing a session', async () => {
    const pin = await reservePin('share-1', 600);
    m.findUnique.mockResolvedValue(textShare('hello there'));

    const res = await app().get(`/api/receive/${pin}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: 'text', text: 'hello there' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(m.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'share-1' } }));
  });

  it('accepts lowercase and padded PIN input', async () => {
    const pin = await reservePin('share-2', 600);
    m.findUnique.mockResolvedValue(textShare('x'));

    const res = await app().get(`/api/receive/${encodeURIComponent(` ${pin.toLowerCase()} `)}`);

    expect(res.status).toBe(200);
  });

  it('returns the generic 404 for an unknown PIN', async () => {
    const res = await app().get('/api/receive/ABCDEF');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'PIN_NOT_FOUND', message: 'That PIN is wrong or has expired' },
    });
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 once the PIN key has expired, even though the share row still exists', async () => {
    const pin = await reservePin('share-3', 600);
    m.findUnique.mockResolvedValue(textShare('still in the db'));
    m.redis.expireNow(`pin:${pin}`);

    const res = await app().get(`/api/receive/${pin}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PIN_NOT_FOUND');
  });

  it('returns the same 404 for a malformed PIN', async () => {
    const res = await app().get('/api/receive/O0I1!!');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PIN_NOT_FOUND');
  });

  it.each([
    ['deleted', { kind: 'TEXT', status: 'DELETED', textContent: null }],
    ['missing', null],
  ])('returns 404 when the share is %s', async (_label, row) => {
    const pin = await reservePin('share-4', 600);
    m.findUnique.mockResolvedValue(row);
    expect((await app().get(`/api/receive/${pin}`)).status).toBe(404);
  });
});

describe('PIN rate limit', () => {
  beforeEach(() => m.redis.flush());
  afterEach(() => vi.resetAllMocks());

  it('allows PIN_RATE_LIMIT (100) lookups per IP, then answers 429 with Retry-After', async () => {
    const pin = await reservePin('share-5', 600);
    m.findUnique.mockResolvedValue(textShare('x'));
    const agent = app();

    for (let i = 0; i < 100; i++) {
      // Mix of right and wrong PINs: every attempt counts.
      const res = await agent.get(`/api/receive/${i % 2 ? pin : 'ZZZZZZ'}`);
      expect(res.status).not.toBe(429);
    }
    const blocked = await agent.get(`/api/receive/${pin}`);

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.message).toBe('Too many PIN attempts. Try again in 10 minutes.');
    expect(Number(blocked.headers['retry-after'])).toBe(PIN_RATE_WINDOW_SECONDS);
  });

  it('counts per IP in rl:pin:{ip} with a 10-minute window', async () => {
    for (let i = 0; i < 100; i++) expect((await hitPinRateLimit('1.1.1.1')).allowed).toBe(true);
    expect((await hitPinRateLimit('1.1.1.1')).allowed).toBe(false);
    expect((await hitPinRateLimit('2.2.2.2')).allowed).toBe(true);
    expect(await m.redis.ttl('rl:pin:1.1.1.1')).toBe(PIN_RATE_WINDOW_SECONDS);
  });

  it('allows lookups again once the window has passed', async () => {
    for (let i = 0; i < 101; i++) await hitPinRateLimit('3.3.3.3');
    m.redis.expireNow('rl:pin:3.3.3.3');
    expect((await hitPinRateLimit('3.3.3.3')).allowed).toBe(true);
  });

  it('repairs a counter that lost its expiry', async () => {
    await m.redis.set('rl:pin:4.4.4.4', '500');
    const result = await hitPinRateLimit('4.4.4.4');
    expect(result).toEqual({ allowed: false, retryAfterSeconds: PIN_RATE_WINDOW_SECONDS });
    expect(await m.redis.ttl('rl:pin:4.4.4.4')).toBe(PIN_RATE_WINDOW_SECONDS);
  });
});
