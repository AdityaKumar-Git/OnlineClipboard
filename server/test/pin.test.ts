import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeRedis } from './helpers/fakeRedis.js';

const fake = vi.hoisted(() => ({ redis: null as unknown as FakeRedis }));
vi.mock('../src/lib/redis.js', async () => {
  const { FakeRedis } = await import('./helpers/fakeRedis.js');
  fake.redis = new FakeRedis();
  return { redis: fake.redis };
});

const pin = await import('../src/services/pin.js');

afterEach(() => vi.restoreAllMocks());
const { PIN_ALPHABET, generatePin, normalizePin, reservePin, lookupPin, releasePin } = pin;

describe('generatePin', () => {
  it('makes 6 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const p = generatePin();
      expect(p).toHaveLength(6);
      for (const ch of p) expect(PIN_ALPHABET).toContain(ch);
    }
  });

  it('never uses I, O, 0 or 1', () => {
    expect(PIN_ALPHABET).not.toMatch(/[IO01]/);
    expect(PIN_ALPHABET).toHaveLength(32);
  });
});

describe('normalizePin', () => {
  it('uppercases and trims valid input', () => {
    expect(normalizePin('  abc234 ')).toBe('ABC234');
  });

  it.each(['ABC23', 'ABC2345', 'ABCD1O', 'ABC 23', ''])('rejects %j', (raw) => {
    expect(normalizePin(raw)).toBeNull();
  });
});

describe('reservePin', () => {
  beforeEach(() => {
    fake.redis.flush();
    vi.restoreAllMocks();
  });

  it('stores pin:{PIN} -> shareId and share-pin:{shareId} -> PIN with the TTL', async () => {
    const p = await reservePin('share-1', 600);

    expect(await fake.redis.get(`pin:${p}`)).toBe('share-1');
    expect(await fake.redis.get('share-pin:share-1')).toBe(p);
    expect(await fake.redis.ttl(`pin:${p}`)).toBe(600);
    expect(await fake.redis.ttl('share-pin:share-1')).toBe(600);
    expect(await lookupPin(p)).toBe('share-1');
  });

  it('retries with a new PIN when the first one is taken', async () => {
    const set = vi.spyOn(fake.redis, 'set');
    set.mockResolvedValueOnce(null); // collision on the first try

    const p = await reservePin('share-2', 300);

    const nxCalls = set.mock.calls.filter((c) => c.includes('NX'));
    expect(nxCalls).toHaveLength(2);
    expect(await lookupPin(p)).toBe('share-2');
  });

  it('gives up with 503 PIN_UNAVAILABLE after 5 collisions', async () => {
    const set = vi.spyOn(fake.redis, 'set').mockResolvedValue(null);

    await expect(reservePin('share-3', 300)).rejects.toMatchObject({ status: 503, code: 'PIN_UNAVAILABLE' });
    expect(set).toHaveBeenCalledTimes(5);
  });
});

describe('lookupPin', () => {
  beforeEach(() => fake.redis.flush());

  it('returns null once the PIN key has expired', async () => {
    const p = await reservePin('share-5', 300);
    fake.redis.expireNow(`pin:${p}`);
    expect(await lookupPin(p)).toBeNull();
  });
});

describe('releasePin', () => {
  beforeEach(() => fake.redis.flush());

  it('removes both keys', async () => {
    const p = await reservePin('share-6', 300);
    await releasePin('share-6');
    expect(await lookupPin(p)).toBeNull();
    expect(await fake.redis.get('share-pin:share-6')).toBeNull();
  });

  it('does not delete a PIN that now belongs to another share', async () => {
    await fake.redis.set('share-pin:old', 'BBBBBB', 'EX', 300);
    await fake.redis.set('pin:BBBBBB', 'new-share', 'EX', 300);

    await releasePin('old');

    expect(await lookupPin('BBBBBB')).toBe('new-share');
  });
});
