// Tests de non-régression de l’interface (Playwright).
// Prérequis : API en mode démonstration (DEMO_MODE=true, `npm run demo:reset`) et interface démarrées
// (`npm run dev` dans backend et frontend). Puis : npm run test:e2e
// Chaque rôle se connecte une seule fois (limite de tentatives de connexion : relever
// LOGIN_RATE_LIMIT_MAX dans backend/.env de démonstration pour enchaîner plusieurs lancements).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 10 * 60 * 1000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.SIGDEP_URL || 'http://127.0.0.1:5173',
    locale: 'fr-FR',
    timezoneId: 'Africa/Kinshasa',
    trace: 'retain-on-failure',
  },
});
