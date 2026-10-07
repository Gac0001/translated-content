// Outils communs aux tests de l’interface.
import { expect } from '@playwright/test';

/** Connexion d’un compte de démonstration (double authentification par le code affiché en démonstration). */
export async function connexion(page, username) {
  await page.goto('/connexion');
  const demo = await page.request.get('/api/demo');
  expect(demo.ok(), 'API en mode démonstration requise (DEMO_MODE=true)').toBeTruthy();
  const { motDePasse } = await demo.json();
  await page.fill('#username', username);
  await page.fill('#password', motDePasse);
  await page.click('button[type=submit]');
  const code = page.locator('#code');
  await Promise.race([code.waitFor({ timeout: 8000 }).catch(() => {}), page.waitForURL((u) => !u.pathname.startsWith('/connexion'), { timeout: 8000 }).catch(() => {})]);
  if (await code.isVisible().catch(() => false)) {
    await code.fill((await (await page.request.get('/api/demo')).json()).code);
    await page.click('button:has-text("Valider")');
  }
  await expect(page.locator('nav[aria-label="Menu principal"]').first()).toBeAttached({ timeout: 15000 });
}
