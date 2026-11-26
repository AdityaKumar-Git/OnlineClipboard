import { prisma } from '../lib/prisma.js';
import type { GoogleIdentity } from './googleAuth.js';

export interface MeResponse {
  id: string;
  email: string;
  name: string | null;
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

export async function getMe(userId: string): Promise<MeResponse | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
}
