import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // VITE_API_TARGET: ke mana /api diteruskan saat dev.
  // Default API lokal; `pnpm dev:web:remote` (mode "remote") memakai API production.
  const { VITE_API_TARGET = 'http://localhost:3000' } = loadEnv(mode, __dirname, 'VITE_');
  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    server: {
      port: 5173,
      proxy: { '/api': { target: VITE_API_TARGET, changeOrigin: true, secure: true } },
    },
  };
});
