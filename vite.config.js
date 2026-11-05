import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    watch: {
      ignored: ['**/dist/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Backend restarts (node --watch) briefly drop the connection. Swallow
        // those transient proxy errors instead of spamming the console; the
        // client already surfaces a retryable failure to the user.
        configure: (proxy) => {
          proxy.on('error', () => {
            // intentionally ignored: transient backend unavailability
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
