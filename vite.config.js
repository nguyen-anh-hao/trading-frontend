import { defineConfig } from 'vite';

// The gateway is reached directly (cross-origin); the gateway has a CORS
// middleware enabled. Override the target via VITE_GATEWAY_URL at build time.
export default defineConfig({
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
  },
});
