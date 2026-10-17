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

  test('Bureau Suivi-Évaluation : note de présentation par étapes, lettre de transmission', async ({ page }) => {
    await connexion(page, 'ag.sev1');
    await page.goto('/evaluations');
    await page.locator('main tbody tr', { hasText: 'En préparation' }).first().click();
    await page.waitForURL(/\/evaluations\/\d+/);
    await expect(page.getByRole('heading', { name: 'Circuit de traitement' })).toBeVisible();
    await expect(page.getByText('Avant de soumettre')).toBeVisible();
    await page.getByRole('tab', { name: 'Note de présentation' }).click();
    await page.getByRole('button', { name: 'Rédiger' }).click();
    await page.getByRole('navigation', { name: 'Rubriques de la note de présentation' }).getByRole('button', { name: /Résumé de l’évaluation/ }).click();
    await page.getByRole('button', { name: 'Reprendre le résumé chiffré' }).click();
    await expect(page.getByLabel('Résumé de l’évaluation')).toHaveValue(/Au titre de l’exercice/);
    await capture(page, 'note-presentation');
    await page.getByRole('button', { name: 'Enregistrer la note' }).click();
    await expect(page.getByText('Note de présentation enregistrée.')).toBeVisible();
    await page.getByRole('tab', { name: 'Lettre de transmission' }).click();
    await expect(page.getByText('Attribué à la signature du Directeur')).toBeVisible();
    await capture(page, 'lettre');
  });

  test('Secrétaire Général : dossier transmis de l’exercice précédent et projections du CDS-MT', async ({ page }) => {
    await connexion(page, 'sg');
    await page.goto('/evaluations');
    await expect(page.locator('main tbody tr', { hasText: 'En préparation' })).toHaveCount(0);
    await page.locator('main tbody tr', { hasText: 'Transmis' }).first().click();
    await page.waitForURL(/\/evaluations\/\d+/);
    await expect(page.getByText(/Transmis au Secrétaire Général le .*lettre N°.\d{3}\//)).toBeVisible();
    await capture(page, 'transmis');
    await page.goto('/evaluations?onglet=cdsmt');
    const cdsmt = page.getByRole('table', { name: 'Projections du CDS-MT' });
    await expect(cdsmt.locator('tfoot')).toContainText('Total');
    await expect(cdsmt.getByText(/Programme 01/)).toBeVisible();
    await capture(page, 'cdsmt');
  });
});
