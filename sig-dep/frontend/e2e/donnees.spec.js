// Données sectorielles après migration vers les composants communs : filtres dans l’adresse,
// circuits (campagne, réponse, bulletin), saisie protégée. Les parcours n’enregistrent rien.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/donnees');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Données sectorielles (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('annuaire : filtres conservés dans l’adresse au retour d’une fiche', async ({ page }) => {
    await connexion(page, 'cd.edi');
    await page.goto('/donnees');
    await page.getByLabel('Province', { exact: true }).selectOption({ label: 'Kinshasa' });
    await expect(page).toHaveURL(/zone=\d+/);
    await expect(page.getByRole('button', { name: 'Effacer les filtres' })).toBeVisible();
    await page.locator('main tbody tr').first().click();
    await page.waitForURL(/\/donnees\/acteurs\//);
    await page.goBack();
    await expect(page.getByLabel('Province', { exact: true })).toHaveValue(/\d+/);
    await capture(page, 'annuaire');
  });

  test('réponse en erreur : circuit, transmission bloquée, saisie protégée', async ({ page }) => {
    await connexion(page, 'ag.doi1');
    await page.goto('/donnees?onglet=campagnes');
    await page.locator('main tbody tr', { hasText: 'Ouverte' }).first().click();
    await page.waitForURL(/\/donnees\/campagnes\/\d+$/);
    await expect(page.getByRole('region', { name: 'Circuit de traitement' })).toBeVisible();
    await capture(page, 'campagne');
    await page.locator('main tbody tr', { hasText: 'erreur' }).first().click();
    await page.waitForURL(/\/reponses\//);
    const panneau = page.getByRole('region', { name: 'Circuit de traitement' });
    await expect(panneau.getByRole('button', { name: 'Transmettre au contrôle' })).toBeDisabled();
    const champ = page.locator('main input[inputmode="numeric"], main input[inputmode="decimal"]').first();
    await champ.fill('12345');
    await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
    await capture(page, 'reponse');
    await page.getByRole('link', { name: 'Données sectorielles' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
    await page.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
    await expect(page).toHaveURL(/\/donnees/);
  });

  test('bulletin à viser : actions dans le circuit, retour avec motif obligatoire', async ({ page }) => {
    await connexion(page, 'cd.edi');
    await page.goto('/donnees?onglet=bulletins');
    await page.locator('main tbody tr', { hasText: 'Soumis' }).first().click();
    await page.waitForURL(/\/donnees\/bulletins\//);
    const panneau = page.getByRole('region', { name: 'Circuit de traitement' });
    await expect(panneau.getByRole('button', { name: 'Viser' })).toBeVisible();
    await panneau.getByRole('button', { name: 'Retourner' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Retourner pour correction' });
    await expect(dialogue.getByRole('button', { name: 'Retourner' })).toBeDisabled();
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await capture(page, 'bulletin');
  });

  test('indicateur : tuiles et évolution par période', async ({ page }) => {
    await connexion(page, 'cd.edi');
    await page.goto('/donnees?onglet=indicateurs');
    await page.locator('main tbody tr').first().click();
    await page.waitForURL(/\/donnees\/indicateurs\//);
    await expect(page.getByRole('table', { name: 'Évolution par période' })).toBeVisible();
    await capture(page, 'indicateur');
  });
});

test.describe('Données sectorielles (téléphone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('annuaire sans débordement horizontal', async ({ page }) => {
    await connexion(page, 'cd.edi');
    await page.goto('/donnees');
    await expect(page.getByRole('combobox', { name: 'Onglets' })).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture(page, 'annuaire-telephone');
  });
});
