import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./console/ui', import.meta.url)),
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false, target: 'es2022' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000', '/legacy': 'http://127.0.0.1:3000' } },
});
