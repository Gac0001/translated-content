// Réunions, décisions et agenda après migration vers les composants communs.
// Les parcours n’enregistrent rien : la démonstration reste intacte.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/reunions');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Réunions, décisions, agenda (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('réunion convoquée : circuit, modification protégée', async ({ page }) => {
    await connexion(page, 'cb.secretariat');
    await page.goto('/reunions');
    await page.locator('main tbody tr', { hasText: 'Convoquée' }).first().click();
    await page.waitForURL(/\/reunions\/\d+$/);
    const panneau = page.getByRole('region', { name: 'Circuit de traitement' });
    await expect(panneau).toBeVisible();
    await capture(page, 'reunion-convoquee');
    await page.getByRole('link', { name: /Modifier/ }).click();
    await page.waitForURL(/\/modifier$/);
    await expect(page.getByLabel(/^Objet/)).not.toHaveValue(''); // réunion chargée dans le formulaire
    await page.getByLabel('Lieu').fill('Salle fictive non enregistrée');
    await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
    await capture(page, 'reunion-modification');
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
    await page.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
    await page.waitForURL(/\/reunions\/\d+$/);
  });

  test('réunion tenue : circuit terminé et décisions au registre', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.goto('/reunions?periode=passees');
    await page.locator('main tbody tr', { hasText: 'Clôturée' }).first().click();
    await page.waitForURL(/\/reunions\/\d+$/);
    await expect(page.getByRole('region', { name: 'Circuit de traitement' }).getByText(/clôturée/i).first()).toBeVisible();
    await expect(page.locator('main a[href^="/decisions/"]').first()).toBeVisible();
    await capture(page, 'reunion-cloturee');
  });

  test('registre des décisions : filtres dans l’adresse ; abandon avec motif obligatoire', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.goto('/decisions');
    await page.getByLabel('Statut', { exact: true }).selectOption('A_EXECUTER');
    await expect(page).toHaveURL(/statut=A_EXECUTER/);
    await capture(page, 'registre');
    await page.locator('main tbody tr').first().click();
    await page.waitForURL(/\/decisions\/\d+$/);
    await expect(page.getByRole('region', { name: 'Circuit de traitement' })).toBeVisible();
    await page.getByRole('button', { name: 'Abandonner la décision' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Abandonner la décision' });
    await expect(dialogue.getByRole('button', { name: 'Abandonner' })).toBeDisabled();
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await capture(page, 'decision');
    await page.goBack();
    await expect(page.getByLabel('Statut', { exact: true })).toHaveValue('A_EXECUTER');
  });

  test('agenda : semaine conservée dans l’adresse', async ({ page }) => {
    await connexion(page, 'cb.secretariat');
    await page.goto('/agenda');
    const libelle = page.getByRole('group', { name: 'Semaine affichée' }).locator('[aria-live]');
    const actuelle = await libelle.innerText();
    await page.getByRole('button', { name: 'Semaine suivante' }).click();
    await expect(libelle).not.toHaveText(actuelle);
    await expect(page).toHaveURL(/semaine=\d{4}-\d{2}-\d{2}/);
    const suivante = await libelle.innerText();
    await page.reload();
    await expect(libelle).toHaveText(suivante);
    await page.getByRole('button', { name: 'Cette semaine' }).click();
    await expect(page).not.toHaveURL(/semaine=/);
    await capture(page, 'agenda');
  });
});

test.describe('Réunions (téléphone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('fiche de réunion sans débordement', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.goto('/reunions?periode=passees');
    await page.locator('main li[tabindex="0"]').first().click();
    await page.waitForURL(/\/reunions\/\d+$/);
    await expect(page.getByRole('region', { name: 'Circuit de traitement' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture(page, 'reunion-telephone');
  });
});
