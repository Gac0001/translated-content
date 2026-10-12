// Présences journalières (1.38.0) : saisie du jour par le Secrétariat de Direction, rapport
// hebdomadaire et rectificatif chez le Directeur, présences personnelles d’un agent.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/presences');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Présences journalières (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('le Secrétariat saisit les listes du jour par étapes (Cadres, Agents, Contrôle)', async ({ page }) => {
    await connexion(page, 'ag.secretariat1');
    await page.goto('/presences');
    await expect(page.getByRole('link', { name: 'Présences du jour' })).toBeVisible();
    await page.locator('main tbody tr', { hasText: 'En préparation' }).first().click();
    await page.waitForURL(/\/presences\/semaines\//);
    await page.getByRole('link', { name: 'Ouvrir' }).first().click();
    await page.waitForURL(/\/presences\/jour\//);
    const nav = page.getByRole('navigation', { name: 'Listes du jour' });
    await expect(nav.getByRole('button')).toHaveCount(3);
    await nav.getByRole('button', { name: /Agents/ }).click();
    const premiere = page.getByLabel(/^H-A, /).first();
    await premiere.fill((await premiere.inputValue()) === '09:05' ? '09:10' : '09:05');
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Présences enregistrées.')).toBeVisible();
    await expect(page.getByText('Retard').first()).toBeVisible();
    await capture(page, 'saisie-agents');
    await nav.getByRole('button', { name: /Contrôle/ }).click();
    await expect(page.getByRole('heading', { name: 'Contrôle des listes du jour' })).toBeVisible();
    await expect(page.getByText(/retard de \d+ min/).first()).toBeVisible();
  });

  test('le Directeur examine le rapport transmis et le rectificatif proposé', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.goto('/presences');
    await page.locator('main tbody tr', { hasText: 'Transmis au Directeur' }).first().click();
    await page.waitForURL(/\/presences\/semaines\//);
    await expect(page.getByRole('button', { name: 'Verrouiller' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rejeter' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Listes de la semaine' }).locator('tbody tr')).toHaveCount(5);
    await page.getByRole('table', { name: 'Rectificatifs' }).locator('tbody tr').first().click();
    const dialogue = page.getByRole('dialog', { name: 'Rectificatif de présence' });
    await expect(dialogue.getByText('Mission').first()).toBeVisible();
    await expect(dialogue.getByRole('button', { name: 'Valider' })).toBeVisible();
    await capture(page, 'rectificatif');
    await dialogue.getByRole('button', { name: 'Fermer', exact: true }).last().click();
    await capture(page, 'rapport-hebdomadaire');
  });

  test('un Chef de Bureau consulte sans pouvoir transmettre', async ({ page }) => {
    await connexion(page, 'cb.coi');
    await page.goto('/presences');
    await page.locator('main tbody tr', { hasText: 'DEP/PRES' }).first().click();
    await page.waitForURL(/\/presences\/semaines\//);
    await expect(page.getByRole('button', { name: /Transmettre|Verrouiller/ })).toHaveCount(0);
  });

  test('un agent consulte ses présences', async ({ page }) => {
    await connexion(page, 'ag.coi1');
    await page.getByRole('link', { name: 'Mes présences' }).click();
    await expect(page.getByRole('table', { name: 'Mes présences' }).locator('tbody tr').first()).toBeVisible();
    await capture(page, 'mes-presences');
  });
});
