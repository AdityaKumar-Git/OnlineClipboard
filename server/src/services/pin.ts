import { randomInt } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { redis } from '../lib/redis.js';

/** No I, O, 0 or 1, so PINs are easy to read and type. 32^6 ≈ 1 billion combinations. */
export const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PIN_LENGTH = 6;
export const MAX_PIN_ATTEMPTS = 5;
const PIN_PATTERN = new RegExp(`^[${PIN_ALPHABET}]{${PIN_LENGTH}}$`);

export const pinKey = (pin: string) => `pin:${pin}`;
export const sharePinKey = (shareId: string) => `share-pin:${shareId}`;

export function generatePin(): string {
  let pin = '';
  for (let i = 0; i < PIN_LENGTH; i++) pin += PIN_ALPHABET[randomInt(PIN_ALPHABET.length)];
  return pin;
}

/** Uppercases and trims user input; returns null if it can't be a valid PIN. */
export function normalizePin(raw: string): string | null {
  const pin = raw.trim().toUpperCase();
  return PIN_PATTERN.test(pin) ? pin : null;
}

/**
 * Reserves a unique PIN for a share. `SET NX EX` makes active PINs unique; on a collision
 * a new PIN is generated (up to MAX_PIN_ATTEMPTS). The PIN is valid only while its key exists.
 */
export async function reservePin(shareId: string, ttlSeconds: number): Promise<string> {
  for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt++) {
    const pin = generatePin();
    const reserved = await redis.set(pinKey(pin), shareId, 'EX', ttlSeconds, 'NX');
    if (reserved === 'OK') {
      // Reverse mapping so deleting a share can kill its PIN early.
      await redis.set(sharePinKey(shareId), pin, 'EX', ttlSeconds);
      return pin;
    }
  }
  throw new AppError(503, 'PIN_UNAVAILABLE', 'Could not create a PIN right now. Please try again.');
}

/** The share id an active PIN points to, or null if the PIN is unknown or expired. */
export async function lookupPin(pin: string): Promise<string | null> {
  return redis.get(pinKey(pin));
}

/** Removes a share's PIN keys. The `pin:` key is only deleted if it still points to this share. */
export async function releasePin(shareId: string): Promise<void> {
  const pin = await redis.get(sharePinKey(shareId));
  if (pin && (await redis.get(pinKey(pin))) === shareId) await redis.del(pinKey(pin));
  await redis.del(sharePinKey(shareId));
}
