import type { Agent } from 'supertest';

/**
 * Signs an agent in through the real /auth/google flow. The test file must mock
 * `verifySignInCode` and `prisma.user.upsert` so no Google or DB call happens.
 */
export async function signIn(agent: Agent): Promise<void> {
  const start = await agent.get('/auth/google');
  const state = new URL(start.headers.location!).searchParams.get('state')!;
  const cb = await agent.get('/auth/google/callback').query({ code: 'test-code', state });
  if (cb.headers.location !== 'http://localhost:5173/') {
    throw new Error(`test sign-in failed, redirected to ${cb.headers.location}`);
  }
}
