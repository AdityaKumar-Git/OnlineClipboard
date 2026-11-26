import { prisma } from '../lib/prisma.js';
import type { GoogleIdentity } from './googleAuth.js';

const RECONNECT_WARNING_MS = 24 * 60 * 60 * 1000;

export interface DriveStatus {
  connected: boolean;
  /** When the refresh token is expected to die (Testing mode), or null if unknown. */
  expiresAt: string | null;
  /** True when the connection dies within 24 hours: the UI shows a reconnect banner. */
  reconnectSoon: boolean;
}

export interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  drive: DriveStatus;
}

/** Find or create the user by Google `sub`; email and name are refreshed on every sign-in. */
export async function upsertUserFromGoogle(identity: GoogleIdentity) {
  return prisma.user.upsert({
    where: { googleSub: identity.sub },
    create: { googleSub: identity.sub, email: identity.email, name: identity.name },
    update: { email: identity.email, name: identity.name },
    select: { id: true },
  });
}

export function driveStatus(
  user: { driveConnected: boolean; driveTokenExpiresAt: Date | null },
  now = Date.now(),
): DriveStatus {
  const expiresAt = user.driveConnected ? user.driveTokenExpiresAt : null;
  return {
    connected: user.driveConnected,
    expiresAt: expiresAt?.toISOString() ?? null,
    reconnectSoon: expiresAt !== null && expiresAt.getTime() - now < RECONNECT_WARNING_MS,
  };
}

export async function getMe(userId: string): Promise<MeResponse | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, driveConnected: true, driveTokenExpiresAt: true },
  });
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, drive: driveStatus(user) };
}
