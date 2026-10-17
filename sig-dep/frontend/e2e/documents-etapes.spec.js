// Documents de service au formulaire par étapes (même mode de remplissage que la fiche PIP).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/documents');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Documents par étapes (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('rapport : étapes, compteur, page de contrôle, brouillon créé', async ({ page }) => {
    await connexion(page, 'ag.sev1');
    await page.goto('/documents/nouveau');
    await page.getByRole('button', { name: /^Rapport/ }).click();
    const nav = page.getByRole('navigation', { name: 'Étapes du document' });
    await expect(nav.getByRole('button')).toHaveCount(4);
    await page.getByLabel('Titre du document').fill('Rapport d’essai par étapes');
    await page.getByLabel(/^Période/).fill('Octobre (essai)');
    await expect(nav.getByRole('button').first()).toContainText(/2\/\d/);
    await nav.getByRole('button', { name: /Contrôle/ }).click();
    const manquantes = page.getByRole('region', { name: 'Rubriques obligatoires manquantes' });
    await expect(manquantes).toBeVisible();
    await manquantes.getByRole('button', { name: /Étape 2 : Réalisations/ }).first().click();
    await expect(page.getByRole('heading', { name: /^2\. Réalisations/ })).toBeVisible();
    await capture(page, 'rapport-etapes');
    await page.getByRole('button', { name: 'Créer le brouillon' }).click();
    await expect(page).toHaveURL(/\/documents\/\d+$/);
  });

  test('lettre de transmission : aperçu en direct', async ({ page }) => {
    await connexion(page, 'ag.sev1');
    await page.goto('/documents/nouveau');
    await page.getByRole('button', { name: /Lettre de transmission/ }).click();
    const apercu = page.getByRole('article', { name: 'Aperçu de la correspondance' });
    await page.getByLabel('Destinataire', { exact: true }).fill('Monsieur le Directeur (essai)');
    await expect(apercu.getByText('Monsieur le Directeur (essai)')).toBeVisible();
    await expect(apercu.getByText(/^N° …\/MIN-ECN\/SGN\/DEP\//)).toBeVisible();
    await capture(page, 'lettre-apercu');
  });
});
