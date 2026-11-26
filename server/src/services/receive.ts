import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { lookupPin, normalizePin } from './pin.js';

export type ReceivedShare = { kind: 'text'; text: string };

/** Wrong, malformed and expired PINs all get the same answer, so guesses learn nothing. */
export const pinNotFound = () => new AppError(404, 'PIN_NOT_FOUND', 'That PIN is wrong or has expired');

/** Resolves an active PIN to its share. Validity comes only from the Redis key existing. */
export async function receiveByPin(rawPin: string): Promise<ReceivedShare> {
  const pin = normalizePin(rawPin);
  if (!pin) throw pinNotFound();

  const shareId = await lookupPin(pin);
  if (!shareId) throw pinNotFound();

  const share = await prisma.share.findUnique({
    where: { id: shareId },
    select: { kind: true, status: true, textContent: true },
  });
  if (!share || share.status !== 'ACTIVE') throw pinNotFound();

  if (share.kind === 'TEXT' && share.textContent !== null) {
    return { kind: 'text', text: share.textContent };
  }
  // File shares are served from Phase 5.
  throw pinNotFound();
}
