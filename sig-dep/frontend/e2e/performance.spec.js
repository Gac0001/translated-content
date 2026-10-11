// Performance (étape 7) : un seul appel périodique (compteurs, notifications, état du système), plus
// d’appel à chaque changement de page, actualisation après une modification ; référentiels lus une fois.
import { test, expect } from '@playwright/test';
import { connexion } from './outils';

test.use({ viewport: { width: 1366, height: 900 } });

const espion = (page) => {
  const appels = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) appels.push(new URL(r.url()).pathname); });
  return appels;
};
const menu = (page, href) => page.locator(`nav[aria-label="Menu principal"] a[href="${href}"]`).first().click();

test('changement de page sans appel des compteurs ; actualisation après une modification', async ({ page }) => {
  const appels = espion(page);
  await connexion(page, 'cd.edi');
  await expect.poll(() => appels.filter((a) => a === '/api/dashboard/compteurs').length).toBeGreaterThan(0);
  // Une fois connecté, les anciens appels séparés ont disparu (la page de connexion lit seule l’état public).
  const apresConnexion = appels.slice(appels.indexOf('/api/dashboard/compteurs'));
  expect(apresConnexion.filter((a) => a === '/api/notifications/compteur' || a === '/api/statut-public')).toEqual([]);

  appels.length = 0;
  for (const href of ['/donnees', '/planification', '/reunions', '/decisions']) {
    await menu(page, href);
    await expect(page.locator('main h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  expect(appels.filter((a) => a === '/api/dashboard/compteurs'), 'aucun appel des compteurs en changeant de page').toEqual([]);

  // Une modification enregistrée actualise les compteurs (cloche comprise).
  await page.goto('/notifications');
  await page.waitForLoadState('networkidle').catch(() => {});
  appels.length = 0;
  await page.getByRole('button', { name: 'Tout marquer comme lu' }).click();
  await expect.poll(() => appels.filter((a) => a === '/api/dashboard/compteurs').length).toBe(1);
  await expect(page.locator('header').getByText('non lues')).toHaveCount(0);
});

test('référentiel lu une seule fois pendant la session', async ({ page }) => {
  const appels = espion(page);
  await connexion(page, 'cd.edi');
  await menu(page, '/donnees');
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('main tbody tr').first().click();
  await expect(page).toHaveURL(/\/donnees\/acteurs\/\d+/);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.goBack();
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => {});
  // Une lecture au plus (deux en mode développement, React montant chaque écran deux fois en parallèle,
  // partagées en un seul appel) : jamais une par écran.
  expect(appels.filter((a) => a === '/api/donnees/referentiel').length).toBe(1);
});
