import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the API runs on :4000. Proxying keeps the session cookie same-origin.
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': API_TARGET,
      '/auth': API_TARGET,
    },
  },
});
