import session, { type Store } from 'express-session';
import RedisStore from 'connect-redis';
import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';

export const SESSION_COOKIE = 'oc.sid';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createRedisSessionStore(): Store {
  return new RedisStore({ client: redis, prefix: 'sess:', ttl: SESSION_TTL_SECONDS });
}

export function sessionMiddleware(store: Store) {
  return session({
    name: SESSION_COOKIE,
    secret: env.SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  });
}

/** Promise wrappers so route handlers can `await` session operations. */
export const regenerateSession = (req: Express.Request) =>
  new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

export const saveSession = (req: Express.Request) =>
  new Promise<void>((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

export const destroySession = (req: Express.Request) =>
  new Promise<void>((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));
