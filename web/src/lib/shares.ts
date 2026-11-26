import { apiFetch } from './api.ts';

/** Mirrors the server (MAX_TEXT_KB, PIN_TTL_OPTIONS_MINUTES); the server is the source of truth. */
export const MAX_TEXT_BYTES = 100 * 1024;
export const TTL_OPTIONS_MINUTES = [1, 2, 5, 10, 15] as const;
export const DEFAULT_TTL_MINUTES = 10;

export const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PIN_LENGTH = 6;

export type ShareMode = 'TEMP' | 'HISTORY';

export interface CreatedShare {
  id: string;
  pin: string;
  pinExpiresAt: string;
}

export type ReceivedShare = { kind: 'text'; text: string };

export function textByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Keeps only characters that can appear in a PIN, uppercased. */
export function cleanPinInput(raw: string): string {
  return [...raw.toUpperCase()]
    .filter((ch) => PIN_ALPHABET.includes(ch))
    .join('')
    .slice(0, PIN_LENGTH);
}

export function createTextShare(input: { text: string; mode: ShareMode; ttlMinutes: number }) {
  return apiFetch<CreatedShare>('/api/shares', {
    method: 'POST',
    body: JSON.stringify({ kind: 'text', ...input }),
  });
}

export function receiveShare(pin: string) {
  return apiFetch<ReceivedShare>(`/api/receive/${encodeURIComponent(pin)}`);
}
