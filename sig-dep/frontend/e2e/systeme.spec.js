// Écrans Système (Admin) après migration vers les composants communs. Rien n’est enregistré.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/systeme');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Système (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('journal d’audit : filtres dans l’adresse, détail d’une entrée, intégrité', async ({ page }) => {
    await connexion(page, 'admin');
    await page.goto('/audit');
    await page.getByLabel('Résultat', { exact: true }).selectOption('SUCCES');
    await expect(page).toHaveURL(/resultat=SUCCES/);
    await page.reload();
    await expect(page.getByLabel('Résultat', { exact: true })).toHaveValue('SUCCES');
    await page.getByRole('table', { name: 'Journal d’audit' }).locator('tbody tr').first().click();
    await expect(page.getByRole('dialog', { name: /Entrée d’audit n°/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Vérifier l’intégrité' }).click();
    await expect(page.getByText(/Journal intègre|Intégrité rompue/)).toBeVisible();
    await capture(page, 'audit');
  });

  test('journal technique : filtre d’état dans l’adresse', async ({ page }) => {
    await connexion(page, 'admin');
    await page.goto('/systeme/erreurs');
    await page.getByLabel('État', { exact: true }).selectOption('toutes');
    await expect(page).toHaveURL(/statut=toutes/);
    await capture(page, 'journal-technique');
  });

  test('sauvegardes : planification modifiable, restauration avec motif de 10 caractères', async ({ page }) => {
    await connexion(page, 'admin');
    await page.goto('/systeme/sauvegardes?onglet=planification');
    const enregistrer = page.getByRole('button', { name: 'Enregistrer', exact: true });
    await expect(enregistrer).toBeDisabled();
    const champ = page.locator('main input[inputmode="numeric"]').first();
    await champ.fill('9');
    await expect(enregistrer).toBeEnabled();
    await capture(page, 'sauvegardes-planification');
    await page.goto('/systeme/sauvegardes');
    const restaurer = page.getByRole('button', { name: 'Restaurer…' }).first();
    if (await restaurer.isVisible().catch(() => false)) {
      await restaurer.click();
      const dialogue = page.getByRole('dialog', { name: 'Demander une restauration' });
      await dialogue.getByRole('textbox').fill('trop court');
      await expect(dialogue.getByRole('button', { name: 'Transmettre au Directeur' })).toBeEnabled();
      await dialogue.getByRole('textbox').fill('court');
      await expect(dialogue.getByRole('button', { name: 'Transmettre au Directeur' })).toBeDisabled();
      await dialogue.getByRole('button', { name: 'Annuler' }).click();
    }
  });

  test('sécurité et réinitialisation : affichage sans alerte intempestive', async ({ page }) => {
    await connexion(page, 'admin');
    await page.goto('/securite');
    await expect(page.locator('main h1')).toBeVisible();
    await page.goto('/systeme/reinitialisation');
    await expect(page.getByText(/Opération irréversible/)).toBeVisible();
    expect((await page.locator('main [role=alert]').allInnerTexts()).filter((t) => t.trim())).toEqual([]);
    await capture(page, 'reinitialisation');
  });
});
