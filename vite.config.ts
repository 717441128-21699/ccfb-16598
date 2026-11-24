/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is enabled so a phone on the LAN can grant microphone access.
// Vite serves a self-signed certificate; the phone only needs to trust it once.
export default defineConfig({
  base: './',
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
