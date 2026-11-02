import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';

// Armoiries de la RDC (image du Gouvernement), versionnées une seule fois à la racine du dépôt.
const ARMOIRIES = path.resolve(__dirname, '../../Armoiri_de_la_RDC_-_Le_Gouvernement.png');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    resolve: { alias: { '@armoiries': ARMOIRIES } },
    server: {
      port: 5173,
      strictPort: true,
      fs: { allow: ['.', ARMOIRIES] },
      // Le frontend appelle /api : Vite relaie vers l’API (même origine → cookie httpOnly sameSite=strict).
      proxy: { '/api': { target: env.VITE_BACKEND_URL || 'http://localhost:4000', changeOrigin: true } },
    },
    preview: { port: 5173, proxy: { '/api': { target: env.VITE_BACKEND_URL || 'http://localhost:4000', changeOrigin: true } } },
  };
});
