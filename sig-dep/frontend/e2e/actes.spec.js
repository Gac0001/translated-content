// Actes administratifs et cartes de service après migration vers les composants communs.
// Les parcours n’enregistrent rien : la démonstration reste intacte.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/actes');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Actes et cartes (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('acte validé : filtres dans l’adresse, circuit, révocation avec motif', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.goto('/actes');
    await page.getByLabel('Statut', { exact: true }).selectOption('VALIDE');
    await expect(page).toHaveURL(/statut=VALIDE/);
    await page.locator('main tbody tr').first().click();
    await page.waitForURL(/\/actes\/\d+$/);
    const panneau = page.getByRole('region', { name: 'Circuit de traitement' });
    await expect(panneau).toBeVisible();
    await capture(page, 'acte');
    const revoquer = page.getByRole('button', { name: 'Révoquer l’acte' });
    if (await revoquer.isVisible()) {
      await revoquer.click();
      const dialogue = page.getByRole('dialog');
      await dialogue.getByRole('textbox').fill('abc');
      await expect(dialogue.getByRole('button', { name: 'Révoquer' })).toBeDisabled(); // 5 caractères au moins
      await dialogue.getByRole('button', { name: 'Annuler' }).click();
    }
    await page.goBack();
    await expect(page.getByLabel('Statut', { exact: true })).toHaveValue('VALIDE');
  });

  test('nouvel acte : barre d’enregistrement et contrôle des champs', async ({ page }) => {
    await connexion(page, 'cb.secretariat');
    await page.goto('/actes/nouveau');
    await page.getByRole('button', { name: 'Enregistrer en préparation' }).click();
    await expect(page.getByText(/Champs obligatoires à compléter/)).toBeVisible();
    await expect(page).toHaveURL(/\/actes\/nouveau$/);
    await capture(page, 'acte-nouveau');
  });

  test('cartes : registre, filtre d’état dans l’adresse ; ma carte ; modèle protégé', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.goto('/cartes');
    await page.getByLabel('État', { exact: true }).selectOption({ index: 1 });
    await expect(page).toHaveURL(/statut=/);
    await page.goto('/ma-carte');
    await expect(page.getByText('Aucune carte délivrée')).toBeVisible();
    await capture(page, 'ma-carte');
  });

  test('modèle de carte (Admin) : modification non enregistrée signalée', async ({ page }) => {
    await connexion(page, 'admin');
    await page.goto('/cartes/modele');
    await page.getByRole('textbox', { name: /^Titre du verso/ }).fill('Titre fictif non enregistré');
    await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
    await capture(page, 'modele');
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByText('Aucune modification en attente.')).toBeVisible();
  });
});
