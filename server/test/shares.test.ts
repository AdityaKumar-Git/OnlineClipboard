import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import session from 'express-session';
import type { FakeRedis } from './helpers/fakeRedis.js';
import { signIn } from './helpers/signIn.js';

const m = vi.hoisted(() => ({
  redis: null as unknown as FakeRedis,
  shareCreate: vi.fn(),
  userUpsert: vi.fn(),
  verifySignInCode: vi.fn(),
}));

vi.mock('../src/lib/redis.js', async () => {
  const { FakeRedis } = await import('./helpers/fakeRedis.js');
  m.redis = new FakeRedis();
  return { redis: m.redis };
});
vi.mock('../src/lib/prisma.js', () => ({
  prisma: { share: { create: m.shareCreate }, user: { upsert: m.userUpsert } },
}));
vi.mock('../src/services/googleAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/googleAuth.js')>()),
  verifySignInCode: m.verifySignInCode,
}));

const { createApp } = await import('../src/app.js');

const USER_ID = 'user-1';
const validBody = { kind: 'text', text: 'hello from my laptop', mode: 'TEMP', ttlMinutes: 10 };

async function signedInAgent() {
  const agent = request.agent(createApp({ sessionStore: new session.MemoryStore() }));
  await signIn(agent);
  return agent;
}

describe('POST /api/shares (text)', () => {
  beforeEach(() => {
    m.redis.flush();
    m.verifySignInCode.mockResolvedValue({ sub: 'sub-1', email: 'a@example.com', name: 'A' });
    m.userUpsert.mockResolvedValue({ id: USER_ID });
    m.shareCreate.mockImplementation(async ({ data }) => data);
  });
  afterEach(() => vi.clearAllMocks());

  it('creates a TEMP share, reserves its PIN in Redis and returns id, pin, pinExpiresAt', async () => {
    const agent = await signedInAgent();
    const before = Date.now();

    const res = await agent.post('/api/shares').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      pin: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/),
      pinExpiresAt: expect.any(String),
    });
    const expiresAt = new Date(res.body.pinExpiresAt).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(10 * 60_000 + 1000);

    // The PIN is live in Redis with the share's TTL.
    expect(await m.redis.get(`pin:${res.body.pin}`)).toBe(res.body.id);
    expect(await m.redis.ttl(`pin:${res.body.pin}`)).toBe(600);
    expect(await m.redis.get(`share-pin:${res.body.id}`)).toBe(res.body.pin);

    const { data } = m.shareCreate.mock.calls[0]![0];
    expect(data).toMatchObject({
      id: res.body.id,
      ownerId: USER_ID,
      kind: 'TEXT',
      textContent: validBody.text,
      pin: res.body.pin,
      mode: 'TEMP',
    });
    expect(data.deleteAfter).toEqual(data.pinExpiresAt);
  });

  it('keeps HISTORY shares (no deleteAfter)', async () => {
    const agent = await signedInAgent();
    const res = await agent.post('/api/shares').send({ ...validBody, mode: 'HISTORY', ttlMinutes: 5 });

    expect(res.status).toBe(201);
    const { data } = m.shareCreate.mock.calls[0]![0];
    expect(data.mode).toBe('HISTORY');
    expect(data.deleteAfter).toBeNull();
    expect(await m.redis.ttl(`pin:${res.body.pin}`)).toBe(300);
  });

  it('requires sign-in', async () => {
    const res = await request(createApp({ sessionStore: new session.MemoryStore() }))
      .post('/api/shares')
      .send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(m.shareCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['ttl below 5', { ttlMinutes: 4 }],
    ['ttl above 15', { ttlMinutes: 16 }],
    ['fractional ttl', { ttlMinutes: 7.5 }],
    ['unknown mode', { mode: 'FOREVER' }],
    ['empty text', { text: '' }],
    ['whitespace-only text', { text: '   \n ' }],
    ['missing text', { text: undefined }],
    ['unknown kind', { kind: 'image' }],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, patch) => {
    const agent = await signedInAgent();
    const res = await agent.post('/api/shares').send({ ...validBody, ...patch });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(m.shareCreate).not.toHaveBeenCalled();
  });

  it('rejects text over MAX_TEXT_KB with 413 and reserves no PIN', async () => {
    const agent = await signedInAgent();
    const res = await agent.post('/api/shares').send({ ...validBody, text: 'x'.repeat(100 * 1024 + 1) });

    expect(res.status).toBe(413);
    expect(res.body.error).toEqual({ code: 'TEXT_TOO_LARGE', message: 'Text must be at most 100 KB' });
    expect(m.shareCreate).not.toHaveBeenCalled();
  });

  it('accepts text of exactly MAX_TEXT_KB, even when JSON escaping makes the body bigger', async () => {
    const agent = await signedInAgent();
    const res = await agent.post('/api/shares').send({ ...validBody, text: '"'.repeat(100 * 1024) });
    expect(res.status).toBe(201);
  });

  it('releases the PIN when the database write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.shareCreate.mockRejectedValue(new Error('db down'));
    const agent = await signedInAgent();

    const res = await agent.post('/api/shares').send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    const { data } = m.shareCreate.mock.calls[0]![0];
    expect(await m.redis.get(`pin:${data.pin}`)).toBeNull();
    expect(await m.redis.get(`share-pin:${data.id}`)).toBeNull();
  });
});
