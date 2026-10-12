// Carrière (1.40.0) : grades du cahier, élévation en grade, promus en attente de poste, carrière de
// l’agent, formulaire des actes de carrière (données fictives de démonstration).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/carriere');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Carrière des agents (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('le Directeur voit les promus en attente de poste et la carrière d’un agent', async ({ page }) => {
    await connexion(page, 'directeur');
    const carte = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Promus en attente de poste' }) }).last();
    await expect(carte.getByText(/BOLAMBA/)).toBeVisible();
    await carte.getByText(/BOLAMBA/).click();
    await page.waitForURL(/\/personnel\/\d+/);
    await expect(page.getByText(/^140 — Chef de Bureau$/).first()).toBeVisible();
    const carriere = page.getByRole('table', { name: 'Carrière' });
    await expect(carriere.getByText(/Grade 140 — Chef de Bureau/)).toBeVisible();
    await expect(carriere.getByRole('link', { name: /DEP\/ACT\// }).first()).toBeVisible();
    await capture(page, 'carriere-agent');
  });

  test('le Secrétariat prépare un acte d’élévation ou de nomination', async ({ page }) => {
    await connexion(page, 'cb.secretariat');
    await page.goto('/actes/nouveau');
    await page.getByLabel(/Type d’acte/).selectOption('ELEVATION_GRADE');
    await expect(page.getByLabel(/Nouveau grade/)).toBeVisible();
    await expect(page.getByLabel(/Date d’effet/)).toBeVisible();
    await expect(page.getByLabel(/Date de fin/)).toHaveCount(0);
    await page.getByLabel(/Type d’acte/).selectOption('NOMINATION');
    const personne = page.getByLabel(/Personne concernée/);
    await personne.selectOption(await personne.locator('option', { hasText: 'BOLAMBA' }).getAttribute('value'));
    // Un poste de commandement occupé : avertissement
    await page.getByLabel(/^Poste/).selectOption({ index: 2 });
    await expect(page.getByText(/titulaire en fonction|grade requis/).first()).toBeVisible();
    await capture(page, 'acte-nomination');
  });

  test('référentiel des grades au format du cahier', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.goto('/cadre-organique?onglet=grades');
    await expect(page.getByRole('cell', { name: '140', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Huissier', exact: true }).first()).toBeVisible();
  });
});
