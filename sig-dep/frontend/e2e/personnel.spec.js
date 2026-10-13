// Personnel (1.41.0) : effectif par structure et par grade, versions du référentiel, groupes de
// travail, données personnelles masquées (données fictives de démonstration).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/personnel');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Personnel et organisation (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('effectif par structure et par grade, versions du référentiel', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.goto('/cadre-organique?onglet=effectif-structures');
    const tableau = page.getByRole('table', { name: 'Effectif par structure et par grade' });
    await expect(tableau.getByText('Bureau Secrétariat de Direction')).toBeVisible();
    await expect(tableau.locator('tfoot')).toContainText('Ensemble de la Direction');
    await expect(page.getByRole('table', { name: 'Promus en attente de poste' }).getByText(/BOLAMBA/)).toBeVisible();
    await capture(page, 'effectif-par-structure');
    await page.goto('/cadre-organique?onglet=versions');
    await expect(page.getByRole('table', { name: 'Versions du référentiel' }).getByText('V1')).toBeVisible();
    await page.getByRole('table', { name: 'Versions du référentiel' }).locator('tbody tr').first().click();
    await expect(page.getByRole('dialog').getByText(/^Version initiale :/)).toBeVisible();
  });

  test('groupe de travail : le Directeur voit la Cellule Genre, ses membres et ses dossiers', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.getByRole('link', { name: 'Groupes de travail' }).click();
    await page.locator('main tbody tr', { hasText: 'Cellule Genre' }).click();
    await page.waitForURL(/\/groupes\/\d+/);
    await expect(page.getByRole('table', { name: 'Membres du groupe' }).getByText('Coordonnateur')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Participants externes' }).getByText('Point focal genre (fictif)')).toBeVisible();
    await expect(page.getByText('compte-rendu-reunion-cellule-genre.pdf')).toBeVisible();
    await capture(page, 'groupe-de-travail');
  });

  test('un agent hors du groupe ne le voit pas ; un Chef ne voit pas les données personnelles', async ({ page }) => {
    await connexion(page, 'ag.str1');
    await page.goto('/groupes');
    await expect(page.getByText('Vous n’êtes membre d’aucun groupe de travail.')).toBeVisible();
  });

  test('un Chef de Bureau consulte une fiche sans les données personnelles', async ({ page }) => {
    await connexion(page, 'cb.coi');
    await page.goto('/personnel');
    await page.locator('main tbody tr', { hasText: 'Attaché' }).first().click();
    await page.waitForURL(/\/personnel\/\d+/);
    await expect(page.getByText(/Données personnelles .* réservées/)).toBeVisible();
  });
});
