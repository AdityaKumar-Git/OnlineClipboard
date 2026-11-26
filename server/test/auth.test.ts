import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import session from 'express-session';

const { upsert, findUnique, verifySignInCode } = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
  verifySignInCode: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: { user: { upsert, findUnique } } }));
vi.mock('../src/lib/redis.js', () => ({ redis: {} }));
// All Google calls are mocked; URL building stays real (it makes no network call).
vi.mock('../src/services/googleAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/googleAuth.js')>()),
  verifySignInCode,
}));

const { createApp } = await import('../src/app.js');

const WEB = 'http://localhost:5173';
const USER = { id: 'user-1', email: 'alice@example.com', name: 'Alice' };

function newAgent() {
  return request.agent(createApp({ sessionStore: new session.MemoryStore() }));
}

/** Runs GET /auth/google and returns the `state` it put in the Google URL. */
async function startSignIn(agent: ReturnType<typeof newAgent>) {
  const res = await agent.get('/auth/google');
  expect(res.status).toBe(302);
  const url = new URL(res.headers.location!);
  return { url, state: url.searchParams.get('state')! };
}

describe('Google sign-in', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('redirects to Google with identity scopes only and a state value', async () => {
    const { url, state } = await startSignIn(newAgent());

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('scope')).not.toContain('drive');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000/auth/google/callback');
    expect(state).toMatch(/^[\w-]{40,}$/);
  });

  it('signs the user in on a valid callback, and /api/me returns them', async () => {
    verifySignInCode.mockResolvedValue({ sub: 'google-sub-1', email: USER.email, name: USER.name });
    upsert.mockResolvedValue({ id: USER.id });
    findUnique.mockResolvedValue(USER);
    const agent = newAgent();
    const { state } = await startSignIn(agent);

    const cb = await agent.get('/auth/google/callback').query({ code: 'auth-code', state });

    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe(`${WEB}/`);
    expect(verifySignInCode).toHaveBeenCalledWith('auth-code');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { googleSub: 'google-sub-1' },
        create: { googleSub: 'google-sub-1', email: USER.email, name: USER.name },
      }),
    );

    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body).toEqual(USER);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: USER.id } }));
  });

  it('rejects a callback whose state does not match', async () => {
    const agent = newAgent();
    await startSignIn(agent);

    const cb = await agent.get('/auth/google/callback').query({ code: 'auth-code', state: 'forged' });

    expect(cb.headers.location).toBe(`${WEB}/login?error=state_mismatch`);
    expect(verifySignInCode).not.toHaveBeenCalled();
    expect((await agent.get('/api/me')).status).toBe(401);
  });

  it('rejects a callback with no prior /auth/google (no state in session)', async () => {
    const cb = await newAgent().get('/auth/google/callback').query({ code: 'c', state: 's' });
    expect(cb.headers.location).toBe(`${WEB}/login?error=state_mismatch`);
  });

  it('sends the user back to login when they deny consent', async () => {
    const agent = newAgent();
    await startSignIn(agent);
    const cb = await agent.get('/auth/google/callback').query({ error: 'access_denied' });
    expect(cb.headers.location).toBe(`${WEB}/login?error=access_denied`);
  });

  it('sends the user back to login when Google verification fails', async () => {
    verifySignInCode.mockRejectedValue(new Error('invalid_grant'));
    const agent = newAgent();
    const { state } = await startSignIn(agent);

    const cb = await agent.get('/auth/google/callback').query({ code: 'bad', state });

    expect(cb.headers.location).toBe(`${WEB}/login?error=signin_failed`);
    expect(upsert).not.toHaveBeenCalled();
    expect((await agent.get('/api/me')).status).toBe(401);
  });

  it('does not let a state be replayed', async () => {
    verifySignInCode.mockResolvedValue({ sub: 's', email: USER.email, name: null });
    upsert.mockResolvedValue({ id: USER.id });
    const agent = newAgent();
    const { state } = await startSignIn(agent);
    await agent.get('/auth/google/callback').query({ code: 'one', state });

    const replay = await agent.get('/auth/google/callback').query({ code: 'two', state });
    expect(replay.headers.location).toBe(`${WEB}/login?error=state_mismatch`);
  });
});

describe('GET /api/me', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 401 with the error shape when not signed in', async () => {
    const res = await newAgent().get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } });
  });

  it('returns 401 and drops the session when the user no longer exists', async () => {
    verifySignInCode.mockResolvedValue({ sub: 's', email: USER.email, name: null });
    upsert.mockResolvedValue({ id: USER.id });
    findUnique.mockResolvedValue(null);
    const agent = newAgent();
    const { state } = await startSignIn(agent);
    await agent.get('/auth/google/callback').query({ code: 'c', state });

    expect((await agent.get('/api/me')).status).toBe(401);
    findUnique.mockResolvedValue(USER);
    expect((await agent.get('/api/me')).status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  beforeEach(() => vi.resetAllMocks());

  it('ends the session', async () => {
    verifySignInCode.mockResolvedValue({ sub: 's', email: USER.email, name: USER.name });
    upsert.mockResolvedValue({ id: USER.id });
    findUnique.mockResolvedValue(USER);
    const agent = newAgent();
    const { state } = await startSignIn(agent);
    await agent.get('/auth/google/callback').query({ code: 'c', state });
    expect((await agent.get('/api/me')).status).toBe(200);

    const out = await agent.post('/auth/logout');

    expect(out.status).toBe(204);
    expect(out.headers['set-cookie']?.[0]).toMatch(/^oc\.sid=;/);
    expect((await agent.get('/api/me')).status).toBe(401);
  });
});
