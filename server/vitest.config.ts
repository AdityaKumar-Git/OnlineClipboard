import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Tests never need real secrets; config falls back to safe defaults.
    env: { NODE_ENV: 'test' },
  },
});
