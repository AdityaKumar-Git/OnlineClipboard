import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { releasePin, reservePin } from './pin.js';

const shareMode = z.enum(['TEMP', 'HISTORY']);
/** The only PIN lifetimes a share can have (the Send page offers exactly these). */
export const PIN_TTL_OPTIONS_MINUTES = [1, 2, 5, 10, 15] as const;

const ttlMinutes = z
  .number()
  .int()
  .refine((v) => (PIN_TTL_OPTIONS_MINUTES as readonly number[]).includes(v), {
    message: `must be one of ${PIN_TTL_OPTIONS_MINUTES.join(', ')}`,
  });

const textShareBody = z.object({
  kind: z.literal('text'),
  text: z.string().refine((t) => t.trim().length > 0, 'must not be empty'),
  mode: shareMode,
  ttlMinutes,
});

// File shares are added in Phase 4.
export const createShareBody = z.discriminatedUnion('kind', [textShareBody]);

export type CreateTextShareInput = z.infer<typeof textShareBody>;

export interface CreatedShare {
  id: string;
  pin: string;
  pinExpiresAt: string;
}

export const MAX_TEXT_BYTES = env.MAX_TEXT_KB * 1024;

export function assertTextSize(text: string) {
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    throw new AppError(413, 'TEXT_TOO_LARGE', `Text must be at most ${env.MAX_TEXT_KB} KB`);
  }
}

/**
 * Reserves a PIN in Redis first (the PIN is valid only while that key exists), then stores
 * the share. If the DB write fails the PIN is released so it can't point at nothing.
 */
export async function createTextShare(ownerId: string, input: CreateTextShareInput): Promise<CreatedShare> {
  assertTextSize(input.text);

  const id = randomUUID();
  const ttlSeconds = input.ttlMinutes * 60;
  const pinExpiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const pin = await reservePin(id, ttlSeconds);

  try {
    await prisma.share.create({
      data: {
        id,
        ownerId,
        kind: 'TEXT',
        textContent: input.text,
        pin,
        mode: input.mode,
        pinExpiresAt,
        deleteAfter: input.mode === 'TEMP' ? pinExpiresAt : null,
      },
    });
  } catch (err) {
    await releasePin(id).catch(() => {});
    throw err;
  }

  return { id, pin, pinExpiresAt: pinExpiresAt.toISOString() };
}
