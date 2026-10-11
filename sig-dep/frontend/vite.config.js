import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      // Le frontend appelle /api : Vite relaie vers l’API (même origine → cookie httpOnly sameSite=strict).
      proxy: { '/api': { target: env.VITE_BACKEND_URL || 'http://localhost:4000', changeOrigin: true } },
    },
    preview: { port: 5173, proxy: { '/api': { target: env.VITE_BACKEND_URL || 'http://localhost:4000', changeOrigin: true } } },
  };
});
