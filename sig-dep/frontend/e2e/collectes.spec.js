// Collecte auprès des services du Secrétariat Général (1.44.0) : campagnes, services et statuts, fichier
// retourné avec son rapport d’anomalies, consolidation ; 1.46.0 : fiche PNSD, lettres d’envoi et de relance,
// suivi des retards, export consolidé (données fictives de démonstration).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/collectes');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Collecte auprès des services (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('Bureau Programme : campagne PTBA, statuts des services, rapport d’anomalies, consolidation', async ({ page }) => {
    await connexion(page, 'ag.prg1');
    await page.getByRole('link', { name: 'Collecte auprès des services' }).click();
    await expect(page.getByRole('table', { name: 'Campagnes de collecte' })).toBeVisible();
    await capture(page, 'campagnes');
    await page.getByRole('link', { name: /Collecte des PTBA/ }).click();
    await page.waitForURL(/\/collectes\/\d+/);
    const services = page.getByRole('table', { name: 'Services de la campagne' });
    await expect(services.locator('tbody tr', { hasText: 'DAF' })).toContainText('Intégré');
    await expect(services.locator('tbody tr', { hasText: 'DRH' })).toContainText('Corrigé');
    await expect(services.locator('tbody tr', { hasText: 'DANTIC' })).toContainText('Attendu');
    await expect(services.getByRole('button', { name: 'Modèle' }).first()).toBeVisible();
    await capture(page, 'campagne');
    await services.locator('tbody tr', { hasText: 'CTA' }).click();
    const fiche = page.getByRole('dialog');
    await expect(fiche.getByRole('table', { name: 'Rapport d’anomalies' })).toContainText('Action budgétaire inconnue');
    await capture(page, 'rapport-anomalies');
    await fiche.getByRole('button', { name: 'Fermer', exact: true }).last().click();
    await page.getByRole('tab', { name: 'Consolidation' }).click();
    await expect(page.getByRole('table', { name: 'Consolidation de la campagne' })).toContainText('Former les gestionnaires de crédits');
  });

  test('Chef du Bureau Programme : contribution à intégrer dans sa file, intégration', async ({ page }) => {
    await connexion(page, 'cb.prg');
    await page.goto('/collectes');
    await page.getByRole('link', { name: /Collecte des PTBA/ }).click();
    await page.waitForURL(/\/collectes\/\d+/);
    await page.getByRole('table', { name: 'Services de la campagne' }).locator('tbody tr', { hasText: 'DRH' }).click();
    const fiche = page.getByRole('dialog');
    await expect(fiche.getByRole('button', { name: 'Intégrer' })).toBeEnabled();
    await expect(fiche.getByRole('button', { name: 'Rejeter' })).toBeVisible();
    await capture(page, 'fiche-service');
  });

  test('Bureau Programme : lettre d’envoi signée, service en retard relancé', async ({ page }) => {
    await connexion(page, 'ag.prg1');
    await page.goto('/collectes');
    await page.getByRole('link', { name: /Collecte des PTBA/ }).click();
    await page.waitForURL(/\/collectes\/\d+/);
    await page.getByRole('tab', { name: /Courriers/ }).click();
    const lettres = page.getByRole('table', { name: 'Lettres de la campagne' });
    await expect(lettres.locator('tbody tr', { hasText: 'Envoi des modèles' })).toContainText(/N° \d{3}\//);
    await capture(page, 'courriers');
    await page.goto('/collectes');
    await page.getByRole('link', { name: /Dépenses d’investissement/ }).click();
    await page.waitForURL(/\/collectes\/\d+/);
    await expect(page.getByRole('table', { name: 'Services de la campagne' }).locator('tbody tr', { hasText: 'DCS' })).toContainText(/jour\(s\) de retard.*Relancé 1 fois/s);
  });

  test('Bureau Suivi-Évaluation : fiche PNSD, consolidation et export, préparation de la lettre d’envoi', async ({ page }) => {
    await connexion(page, 'ag.sev1');
    await page.goto('/collectes');
    await page.getByRole('link', { name: /Revue du PNSD/ }).click();
    await page.waitForURL(/\/collectes\/\d+/);
    await page.getByRole('tab', { name: 'Consolidation' }).click();
    await expect(page.getByRole('table', { name: 'Consolidation de la campagne' })).toContainText('Dématérialisation de la chaîne de la dépense');
    const [fichier] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter (Excel)' }).click()]);
    expect(fichier.suggestedFilename()).toMatch(/^collecte-fiche_pnsd-\d{4}-\d{4}\.xlsx$/);
    await capture(page, 'consolidation-pnsd');
    await page.getByRole('tab', { name: /Courriers/ }).click();
    await expect(page.getByRole('table', { name: 'Lettres de la campagne' })).toContainText('Attribué à la signature du Directeur');
    await page.getByRole('button', { name: /Préparer une relance/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Préparer le brouillon' }).click();
    await expect(page.getByText(/Brouillon DEP\/LT\/\d{4}\/\d{4} préparé/)).toBeVisible();
    await expect(page.getByRole('table', { name: 'Lettres de la campagne' }).locator('tbody tr', { hasText: 'Relance' }).last()).toContainText('DIN');
  });
});
