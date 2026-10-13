import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: react(),
  base: '/',
  publicDir: false,
  build: {
    outDir: 'public/react',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        room: resolve(__dirname, 'web/room.html'),
        analysis: resolve(__dirname, 'web/analysis.html')
      }
    }
  }
});
