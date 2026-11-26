import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * AES-256-GCM for secrets at rest (Drive refresh tokens).
 * Stored format: `iv:authTag:ciphertext`, each part base64.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM recommendation
const TAG_BYTES = 16;

function keyFromEnv(): Buffer {
  return Buffer.from(env.TOKEN_ENC_KEY, 'base64');
}

export function encrypt(plaintext: string, key: Buffer = keyFromEnv()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString('base64')).join(':');
}

/** Throws if the payload is malformed, was tampered with, or was encrypted with another key. */
export function decrypt(payload: string, key: Buffer = keyFromEnv()): string {
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Encrypted value has an invalid format');
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64')) as [Buffer, Buffer, Buffer];
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Encrypted value has an invalid format');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Never include the payload or key in the error.
    throw new Error('Encrypted value could not be decrypted');
  }
}
