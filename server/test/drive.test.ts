import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import session from 'express-session';
import type { FakeRedis } from './helpers/fakeRedis.js';
import { signIn } from './helpers/signIn.js';

type UserRow = {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
  driveConnected: boolean;
  driveRefreshTokenEnc: string | null;
  driveFolderId: string | null;
  driveConnectedAt: Date | null;
  driveTokenExpiresAt: Date | null;
};

const m = vi.hoisted(() => ({
  redis: null as unknown as FakeRedis,
  users: new Map<string, UserRow>(),
  verifySignInCode: vi.fn(),
  exchangeDriveCode: vi.fn(),
  refreshDriveAccessToken: vi.fn(),
  revokeGoogleToken: vi.fn(),
  filesGet: vi.fn(),
  filesCreate: vi.fn(),
}));

vi.mock('../src/lib/redis.js', async () => {
  const { FakeRedis } = await import('./helpers/fakeRedis.js');
  m.redis = new FakeRedis();
  return { redis: m.redis };
});

// Tiny in-memory User table (select is ignored: full rows are returned).
vi.mock('../src/lib/prisma.js', () => {
  const find = (where: { id?: string; googleSub?: string }) =>
    [...m.users.values()].find((u) => (where.id ? u.id === where.id : u.googleSub === where.googleSub)) ??
    null;
  return {
    prisma: {
      user: {
        findUnique: vi.fn(async ({ where }) => find(where)),
        update: vi.fn(async ({ where, data }) => {
          const u = find(where);
          if (!u) throw new Error('not found');
          Object.assign(u, data);
          return u;
        }),
        upsert: vi.fn(async ({ where, create }) => {
          const existing = find(where);
          if (existing) return existing;
          const row: UserRow = {
            id: 'user-1',
            name: null,
            driveConnected: false,
            driveRefreshTokenEnc: null,
            driveFolderId: null,
            driveConnectedAt: null,
            driveTokenExpiresAt: null,
            ...create,
          };
          m.users.set(row.id, row);
          return row;
        }),
      },
    },
  };
});

// Every Google call is mocked; URL building and error classification stay real.
vi.mock('../src/services/googleAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/googleAuth.js')>()),
  verifySignInCode: m.verifySignInCode,
  exchangeDriveCode: m.exchangeDriveCode,
  refreshDriveAccessToken: m.refreshDriveAccessToken,
  revokeGoogleToken: m.revokeGoogleToken,
}));
vi.mock('../src/lib/google.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/google.js')>()),
  driveFor: () => ({ files: { get: m.filesGet, create: m.filesCreate } }),
}));

const { createApp } = await import('../src/app.js');
const { decrypt } = await import('../src/services/crypto.js');
const { driveStatus } = await import('../src/services/users.js');

const WEB = 'http://localhost:5173';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const REFRESH = '1//refresh-token-secret';
const DAY = 24 * 60 * 60 * 1000;

const grant = (over: Partial<Record<string, unknown>> = {}) => ({
  sub: 'sub-1',
  refreshToken: REFRESH,
  accessToken: 'access-1',
  expiresInSeconds: 3599,
  scopes: ['openid', DRIVE_FILE],
  ...over,
});
const user = () => m.users.get('user-1')!;
const notFoundError = () => Object.assign(new Error('File not found'), { status: 404 });

async function signedInAgent() {
  const agent = request.agent(createApp({ sessionStore: new session.MemoryStore() }));
  await signIn(agent);
  return agent;
}

/** Runs /auth/google/drive + callback with the given grant; returns the callback redirect. */
async function connect(agent: Awaited<ReturnType<typeof signedInAgent>>, g = grant()) {
  m.exchangeDriveCode.mockResolvedValueOnce(g);
  const start = await agent.get('/auth/google/drive');
  const state = new URL(start.headers.location!).searchParams.get('state')!;
  const cb = await agent.get('/auth/google/drive/callback').query({ code: 'drive-code', state });
  return cb.headers.location as string;
}

beforeEach(() => {
  m.users.clear();
  m.redis.flush();
  m.verifySignInCode.mockResolvedValue({ sub: 'sub-1', email: 'alice@example.com', name: 'Alice' });
  m.filesCreate.mockResolvedValue({ data: { id: 'folder-new' } });
  m.revokeGoogleToken.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.clearAllMocks());

describe('GET /auth/google/drive', () => {
  it('sends signed-out users to the login page', async () => {
    const res = await request(createApp({ sessionStore: new session.MemoryStore() })).get(
      '/auth/google/drive',
    );
    expect(res.headers.location).toBe(`${WEB}/login`);
  });

  it('asks Google for drive.file only, offline, with consent and incremental auth', async () => {
    const agent = await signedInAgent();
    const res = await agent.get('/auth/google/drive');
    const url = new URL(res.headers.location!);

    expect(url.origin).toBe('https://accounts.google.com');
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes).toEqual(['openid', DRIVE_FILE]);
    expect(scopes.some((s) => s === 'https://www.googleapis.com/auth/drive')).toBe(false);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('login_hint')).toBe('alice@example.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000/auth/google/drive/callback');
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{40,}$/);
  });
});

describe('GET /auth/google/drive/callback', () => {
  it('first connect: encrypts the refresh token, sets expiry, creates the app folder, caches the access token', async () => {
    const agent = await signedInAgent();
    const before = Date.now();

    expect(await connect(agent)).toBe(`${WEB}/?drive=connected`);

    const u = user();
    expect(u.driveConnected).toBe(true);
    expect(u.driveRefreshTokenEnc).not.toContain(REFRESH);
    expect(decrypt(u.driveRefreshTokenEnc!)).toBe(REFRESH);
    expect(u.driveFolderId).toBe('folder-new');
    expect(u.driveConnectedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(u.driveTokenExpiresAt!.getTime() - u.driveConnectedAt!.getTime()).toBe(7 * DAY);
    expect(m.filesGet).not.toHaveBeenCalled();
    expect(m.filesCreate).toHaveBeenCalledWith({
      requestBody: { name: 'Online Clipboard', mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    expect(await m.redis.get('gtoken:user-1')).toBe('access-1');
    expect(await m.redis.ttl('gtoken:user-1')).toBe(3599 - 60);

    const me = await agent.get('/api/me');
    expect(me.body.drive).toEqual({
      connected: true,
      expiresAt: u.driveTokenExpiresAt!.toISOString(),
      reconnectSoon: false,
    });
  });

  it('reconnect: keeps the existing folder when it is still there', async () => {
    const agent = await signedInAgent();
    await connect(agent);
    m.filesGet.mockResolvedValue({
      data: { id: 'folder-new', trashed: false, mimeType: 'application/vnd.google-apps.folder' },
    });
    m.filesCreate.mockClear();

    expect(await connect(agent, grant({ refreshToken: '1//second' }))).toBe(`${WEB}/?drive=connected`);

    expect(m.filesGet).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'folder-new' }));
    expect(m.filesCreate).not.toHaveBeenCalled();
    expect(decrypt(user().driveRefreshTokenEnc!)).toBe('1//second');
  });

  it.each([
    ['deleted (404)', () => m.filesGet.mockRejectedValue(notFoundError())],
    [
      'trashed',
      () =>
        m.filesGet.mockResolvedValue({
          data: { id: 'folder-new', trashed: true, mimeType: 'application/vnd.google-apps.folder' },
        }),
    ],
  ])('reconnect: recreates the folder when it was %s', async (_label, arrange) => {
    const agent = await signedInAgent();
    await connect(agent);
    arrange();
    m.filesCreate.mockResolvedValue({ data: { id: 'folder-2' } });

    await connect(agent);

    expect(user().driveFolderId).toBe('folder-2');
  });

  it('rejects a different Google account and revokes its grant', async () => {
    const agent = await signedInAgent();

    const location = await connect(agent, grant({ sub: 'someone-else' }));

    expect(location).toBe(`${WEB}/?drive_error=drive_account_mismatch`);
    expect(m.revokeGoogleToken).toHaveBeenCalledWith(REFRESH);
    expect(user().driveConnected).toBe(false);
    expect(user().driveRefreshTokenEnc).toBeNull();
  });

  it('reports drive_api_disabled when the Drive API is off in the Cloud project', async () => {
    m.filesCreate.mockRejectedValue(
      Object.assign(
        new Error('Google Drive API has not been used in project 123 before or it is disabled.'),
        {
          status: 403,
          response: { status: 403, data: { error: { errors: [{ reason: 'accessNotConfigured' }] } } },
        },
      ),
    );
    const agent = await signedInAgent();

    expect(await connect(agent)).toBe(`${WEB}/?drive_error=drive_api_disabled`);
    expect(user().driveConnected).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      '[auth] drive connect failed (drive_api_disabled):',
      expect.stringContaining('status=503'),
    );
  });

  it('logs Google status and reason (never the request) for unexpected Google errors', async () => {
    m.exchangeDriveCode.mockReset();
    const agent = await signedInAgent();
    const err = Object.assign(new Error('invalid_client'), {
      status: 401,
      config: { data: 'client_secret=SHOULD-NOT-BE-LOGGED&code=drive-code' },
      response: { status: 401, data: { error: 'invalid_client', error_description: 'Unauthorized' } },
    });
    m.exchangeDriveCode.mockRejectedValueOnce(err);
    const start = await agent.get('/auth/google/drive');
    const state = new URL(start.headers.location!).searchParams.get('state')!;

    const cb = await agent.get('/auth/google/drive/callback').query({ code: 'drive-code', state });

    expect(cb.headers.location).toBe(`${WEB}/?drive_error=connect_failed`);
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).toContain('status=401 reason=invalid_client message=invalid_client');
    expect(logged).not.toContain('SHOULD-NOT-BE-LOGGED');
  });

  it('rejects a grant without drive.file (user unticked the Drive box)', async () => {
    const agent = await signedInAgent();
    const location = await connect(agent, grant({ scopes: ['openid'] }));
    expect(location).toBe(`${WEB}/?drive_error=drive_scope_missing`);
    expect(user().driveConnected).toBe(false);
  });

  it('rejects a grant without a refresh token', async () => {
    const agent = await signedInAgent();
    const location = await connect(agent, grant({ refreshToken: null }));
    expect(location).toBe(`${WEB}/?drive_error=no_refresh_token`);
    expect(user().driveConnected).toBe(false);
  });

  it('rejects a mismatched state without calling Google', async () => {
    const agent = await signedInAgent();
    await agent.get('/auth/google/drive');
    const cb = await agent.get('/auth/google/drive/callback').query({ code: 'c', state: 'forged' });
    expect(cb.headers.location).toBe(`${WEB}/?drive_error=state_mismatch`);
    expect(m.exchangeDriveCode).not.toHaveBeenCalled();
  });

  it('handles the user cancelling consent', async () => {
    const agent = await signedInAgent();
    await agent.get('/auth/google/drive');
    const cb = await agent.get('/auth/google/drive/callback').query({ error: 'access_denied' });
    expect(cb.headers.location).toBe(`${WEB}/?drive_error=access_denied`);
  });

  it('sends signed-out users to login', async () => {
    const res = await request(createApp({ sessionStore: new session.MemoryStore() }))
      .get('/auth/google/drive/callback')
      .query({ code: 'c', state: 's' });
    expect(res.headers.location).toBe(`${WEB}/login`);
  });
});

describe('GET /api/drive/token', () => {
  it('returns the cached access token and folder id, never the refresh token', async () => {
    const agent = await signedInAgent();
    await connect(agent);

    const res = await agent.get('/api/drive/token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: 'access-1', folderId: 'folder-new' });
    expect(JSON.stringify(res.body)).not.toContain(REFRESH);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(m.refreshDriveAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes with the decrypted refresh token on a cache miss and caches the result', async () => {
    const agent = await signedInAgent();
    await connect(agent);
    m.redis.expireNow('gtoken:user-1');
    m.refreshDriveAccessToken.mockResolvedValue({ accessToken: 'access-2', expiresInSeconds: 3000 });

    const res = await agent.get('/api/drive/token');

    expect(res.body.accessToken).toBe('access-2');
    expect(m.refreshDriveAccessToken).toHaveBeenCalledWith(REFRESH);
    expect(await m.redis.get('gtoken:user-1')).toBe('access-2');
    expect(await m.redis.ttl('gtoken:user-1')).toBe(3000 - 60);
  });

  it('marks Drive disconnected on invalid_grant and answers 409', async () => {
    const agent = await signedInAgent();
    await connect(agent);
    m.redis.expireNow('gtoken:user-1');
    m.refreshDriveAccessToken.mockRejectedValue(
      Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant' } } }),
    );

    const res = await agent.get('/api/drive/token');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DRIVE_NOT_CONNECTED');
    expect(user().driveConnected).toBe(false);
    expect(user().driveRefreshTokenEnc).toBeNull();
    expect((await agent.get('/api/me')).body.drive.connected).toBe(false);
  });

  it('answers 502 on other Google errors and keeps the connection', async () => {
    const agent = await signedInAgent();
    await connect(agent);
    m.redis.expireNow('gtoken:user-1');
    m.refreshDriveAccessToken.mockRejectedValue(new Error('socket hang up'));

    const res = await agent.get('/api/drive/token');

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('GOOGLE_UNAVAILABLE');
    expect(user().driveConnected).toBe(true);
  });

  it('answers 409 when Drive was never connected', async () => {
    const agent = await signedInAgent();
    const res = await agent.get('/api/drive/token');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DRIVE_NOT_CONNECTED');
  });

  it('requires sign-in', async () => {
    const res = await request(createApp({ sessionStore: new session.MemoryStore() })).get('/api/drive/token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/drive/disconnect', () => {
  it('revokes the token at Google, clears it, and keeps the folder id', async () => {
    const agent = await signedInAgent();
    await connect(agent);

    const res = await agent.post('/api/drive/disconnect');

    expect(res.status).toBe(204);
    expect(m.revokeGoogleToken).toHaveBeenCalledWith(REFRESH);
    expect(user()).toMatchObject({
      driveConnected: false,
      driveRefreshTokenEnc: null,
      driveTokenExpiresAt: null,
      driveFolderId: 'folder-new',
    });
    expect(await m.redis.get('gtoken:user-1')).toBeNull();
    expect((await agent.get('/api/drive/token')).status).toBe(409);
  });

  it('still disconnects when Google refuses the revoke (token already dead)', async () => {
    const agent = await signedInAgent();
    await connect(agent);
    m.revokeGoogleToken.mockRejectedValue(new Error('invalid_token'));

    expect((await agent.post('/api/drive/disconnect')).status).toBe(204);
    expect(user().driveConnected).toBe(false);
  });
});

describe('driveStatus (reconnectSoon)', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const at = (ms: number) => new Date(now + ms);

  it.each([
    ['expires in 23h', true, at(23 * 60 * 60 * 1000), true],
    ['expires in 25h', true, at(25 * 60 * 60 * 1000), false],
    ['already expired', true, at(-1000), true],
    ['no known expiry (production mode)', true, null, false],
    ['not connected', false, at(60 * 1000), false],
  ])('%s', (_label, connected, expiresAt, expected) => {
    const status = driveStatus({ driveConnected: connected, driveTokenExpiresAt: expiresAt }, now);
    expect(status.reconnectSoon).toBe(expected);
    if (!connected) expect(status.expiresAt).toBeNull();
  });
});
