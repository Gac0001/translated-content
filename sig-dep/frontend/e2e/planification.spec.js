// Planification après migration vers les composants communs : grilles de crédits, circuit, éditeurs.
// Les parcours n’enregistrent rien : la démonstration reste intacte.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/planification');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Planification (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('crédits : grille, cellule modifiée, protection au changement d’onglet', async ({ page }) => {
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    await connexion(page, 'cb.prg');
    await page.goto('/planification?onglet=credits');
    await expect(page.getByRole('heading', { name: /Respect du cadrage budgétaire/ })).toBeVisible();
    await capture(page, 'credits');
    const cellule = page.locator('main table input').first();
    await cellule.fill('123456789');
    await expect(cellule).toHaveClass(/border-amber-400/);
    await expect(page.getByRole('button', { name: 'Enregistrer (1)' }).first()).toBeEnabled();
    await page.getByRole('tab', { name: 'Performance' }).click();
    await expect(page.getByRole('dialog', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
    await page.getByRole('button', { name: 'Rester sur la page' }).click();
    await expect(page).toHaveURL(/onglet=credits/);
    await page.getByRole('tab', { name: 'Performance' }).click();
    await page.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
    await expect(page).toHaveURL(/onglet=performance/);
    await capture(page, 'performance');
    expect(erreurs).toEqual([]);
  });

  test('PTBA soumis : circuit de traitement et retour avec motif obligatoire', async ({ page }) => {
    await connexion(page, 'cb.prg');
    await page.goto('/planification');
    await page.getByLabel('Exercice').selectOption(String(new Date().getFullYear())); // PTBA soumis : exercice en cours
    await page.locator('main tbody tr', { hasText: 'Soumis' }).first().click();
    await page.waitForURL(/\/planification\/ptba\//);
    const panneau = page.getByRole('region', { name: 'Circuit de traitement' });
    await expect(panneau).toBeVisible();
    await expect(panneau.getByText('Chez le Chef du Bureau Programme').first()).toBeVisible();
    await panneau.getByRole('button', { name: 'Retourner' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Retourner pour correction' });
    await expect(dialogue.getByRole('button', { name: 'Retourner' })).toBeDisabled();
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await capture(page, 'ptba-soumis');
  });

  test('document en préparation : éditeur avec barre d’enregistrement', async ({ page }) => {
    await connexion(page, 'cb.prg');
    await page.goto('/planification?onglet=documents');
    await page.locator('main tbody tr', { hasText: /Brouillon|À corriger/ }).first().click();
    await page.waitForURL(/\/planification\/documents\//);
    await page.getByRole('button', { name: 'Rédiger' }).click();
    await expect(page.getByText('Aucune modification en attente.')).toBeVisible();
    await page.getByLabel('Responsable').fill('Responsable fictif non enregistré');
    await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
    await capture(page, 'document-edition');
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('region', { name: 'Circuit de traitement' })).toBeVisible();
  });
});

test.describe('Planification (téléphone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('fiche PTBA : exports regroupés sous « Actions », pas de débordement', async ({ page }) => {
    await connexion(page, 'cb.prg');
    await page.goto('/planification');
    await page.locator('main li[tabindex="0"]').first().click();
    await page.waitForURL(/\/planification\/ptba\//);
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Excel' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture(page, 'ptba-telephone');
  });
});
