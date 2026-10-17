// Menu latéral : sections repliables mémorisées, section de la page affichée toujours ouverte,
// sections « Personnel et habilitations » et « Sécurité et système », « Ma carte » dans le menu utilisateur.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/menu');
fs.mkdirSync(dossier, { recursive: true });

test.use({ viewport: { width: 1366, height: 900 } });

test('sections repliables, mémorisées, section active toujours ouverte', async ({ page }) => {
  await connexion(page, 'directeur');
  const menu = page.locator('aside nav[aria-label="Menu principal"]');
  const activites = menu.getByRole('button', { name: /Activités/ });
  await expect(activites).toHaveAttribute('aria-expanded', 'true');
  await activites.click();
  await expect(activites).toHaveAttribute('aria-expanded', 'false');
  await expect(menu.getByRole('link', { name: 'Courriers' })).toBeHidden();
  await page.reload();
  await expect(menu.getByRole('button', { name: /Activités/ })).toHaveAttribute('aria-expanded', 'false');
  // Une page de la section repliée la rouvre (sans changer le choix mémorisé).
  await page.goto('/courriers');
  await expect(menu.getByRole('link', { name: 'Courriers' })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Activités/ })).toBeDisabled();
  await page.screenshot({ path: path.join(dossier, 'directeur.png') });
  await page.goto('/');
  await expect(menu.getByRole('link', { name: 'Courriers' })).toBeHidden();
  await menu.getByRole('button', { name: /Activités/ }).click();
  await expect(menu.getByRole('link', { name: 'Courriers' })).toBeVisible();
});

test('Admin : sections « Personnel et habilitations » et « Sécurité et système », réinitialisation hors menu', async ({ page }) => {
  await connexion(page, 'admin');
  const menu = page.locator('aside nav[aria-label="Menu principal"]');
  await expect(menu.getByRole('button', { name: /Sécurité et système/ })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Réinitialisation' })).toHaveCount(0);
  await page.goto('/systeme');
  await expect(page.getByRole('link', { name: /Réinitialisation de la base/ })).toBeVisible();
  await page.screenshot({ path: path.join(dossier, 'admin.png') });
});

test('« Ma carte de service » dans le menu utilisateur', async ({ page }) => {
  await connexion(page, 'ag.prg1');
  await page.locator('header button[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: 'Ma carte de service' }).click();
  await expect(page).toHaveURL(/\/ma-carte$/);
});
