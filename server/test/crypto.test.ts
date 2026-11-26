import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/services/crypto.js';

const TOKEN = '1//0gExampleRefreshToken-abc_DEF.123';

function tamper(payload: string, index: 0 | 1 | 2) {
  const parts = payload.split(':');
  const bytes = Buffer.from(parts[index]!, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  parts[index] = bytes.toString('base64');
  return parts.join(':');
}

describe('crypto (AES-256-GCM)', () => {
  it('round-trips a refresh token', () => {
    expect(decrypt(encrypt(TOKEN))).toBe(TOKEN);
  });

  it('round-trips unicode and empty strings', () => {
    expect(decrypt(encrypt('héllo ✓ 世界'))).toBe('héllo ✓ 世界');
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('stores iv:authTag:ciphertext as base64 and never contains the plaintext', () => {
    const payload = encrypt(TOKEN);
    const [iv, tag, ct] = payload.split(':');

    expect(payload.split(':')).toHaveLength(3);
    expect(Buffer.from(iv!, 'base64')).toHaveLength(12);
    expect(Buffer.from(tag!, 'base64')).toHaveLength(16);
    expect(Buffer.from(ct!, 'base64')).toHaveLength(Buffer.byteLength(TOKEN));
    expect(payload).not.toContain(TOKEN);
  });

  it('uses a fresh IV every time', () => {
    const a = encrypt(TOKEN);
    const b = encrypt(TOKEN);
    expect(a).not.toBe(b);
    expect(a.split(':')[0]).not.toBe(b.split(':')[0]);
  });

  it.each([
    ['IV', 0],
    ['auth tag', 1],
    ['ciphertext', 2],
  ] as const)('rejects a tampered %s', (_label, index) => {
    expect(() => decrypt(tamper(encrypt(TOKEN), index))).toThrow('could not be decrypted');
  });

  it('rejects a value encrypted with a different key', () => {
    const other = encrypt(TOKEN, randomBytes(32));
    expect(() => decrypt(other)).toThrow('could not be decrypted');
  });

  it.each(['', 'not-encrypted', 'a:b', 'a:b:c:d', 'AAAA:AAAA:AAAA'])('rejects malformed input %j', (bad) => {
    expect(() => decrypt(bad)).toThrow();
  });

  it('does not leak the payload in error messages', () => {
    const payload = tamper(encrypt(TOKEN), 2);
    try {
      decrypt(payload);
    } catch (err) {
      expect((err as Error).message).not.toContain(payload.split(':')[2]);
    }
  });
});
