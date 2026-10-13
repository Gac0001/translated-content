// Évaluation des politiques sectorielles et budgétaires (1.42.0) : dossier de l’exercice, annexes
// reprises du SIG-DEP, saisie et contrôles (données fictives de démonstration).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/evaluation');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Évaluation des politiques (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('Bureau Suivi-Évaluation : synthèse des contrôles, annexe I, saisie d’une ligne', async ({ page }) => {
    await connexion(page, 'ag.sev1');
    await page.getByRole('link', { name: 'Évaluation des politiques' }).click();
    await page.locator('main tbody tr', { hasText: 'Évaluation' }).first().click();
    await page.waitForURL(/\/evaluations\/\d+/);
    await expect(page.getByRole('table', { name: 'Anomalies du dossier' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Synthèse des annexes' }).getByText(/Annexe V/)).toBeVisible();
    await expect(page.getByText('convocation-evaluation-demonstration.pdf')).toBeVisible();
    await capture(page, 'synthese');
    await page.getByRole('tab', { name: /^Annexe I\d*$/ }).click();
    const annexe = page.getByRole('table', { name: /Annexe I — Politiques sectorielles/ });
    await expect(annexe.locator('tfoot')).toContainText('Total');
    await annexe.locator('tbody tr').first().click();
    const fenetre = page.getByRole('dialog');
    await expect(fenetre.getByText('Calculé : Taux d’exécution')).toBeVisible();
    await fenetre.getByLabel('Reconduction').selectOption('oui');
    await fenetre.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Ligne enregistrée.')).toBeVisible();
    await capture(page, 'annexe-I');
    await page.getByRole('tab', { name: /^Annexe III\d*$/ }).click();
    await expect(page.getByRole('table', { name: /Annexe III/ }).locator('tfoot')).toContainText('Total');
    await capture(page, 'annexe-III');
  });

  test('Bureau Programme : seule la projection (annexe II) est modifiable', async ({ page }) => {
    await connexion(page, 'ag.prg1');
    await page.goto('/evaluations');
    await page.locator('main tbody tr', { hasText: 'Évaluation' }).first().click();
    await page.waitForURL(/\/evaluations\/\d+/);
    await page.getByRole('tab', { name: /^Annexe II\d*$/ }).click();
    await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toBeVisible();
    await capture(page, 'annexe-II');
    await page.getByRole('tab', { name: /^Annexe V\d*$/ }).click();
    await expect(page.getByRole('table', { name: /Annexe V/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toHaveCount(0);
  });

  test('Secrétaire Général : dossier non visible avant validation', async ({ page }) => {
    await connexion(page, 'sg');
    await page.goto('/evaluations');
    await expect(page.getByText('Aucun dossier d’évaluation')).toBeVisible();
  });
});
