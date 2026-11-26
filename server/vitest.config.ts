import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Fixed fake values: tests never read the real .env and never call Google.
    env: {
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:5173',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:4000/auth/google/callback',
      GOOGLE_DRIVE_REDIRECT_URI: 'http://localhost:4000/auth/google/drive/callback',
      // 32 bytes of 0x01, base64. Test-only key.
      TOKEN_ENC_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      DRIVE_REFRESH_TOKEN_TTL_DAYS: '7',
    },
  },
});
