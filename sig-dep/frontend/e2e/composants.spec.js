// Comportement des composants communs (catalogue /composants, données fictives) et des onglets dans l’URL.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/composants');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Composants (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('saisie chiffrée, grille, barre d’enregistrement et protection de la saisie', async ({ page }) => {
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    await connexion(page, 'cb.prg');
    await page.goto('/composants');
    await expect(page).toHaveTitle('Catalogue des composants — SIG-DEP');

    // Champ montant : saisie libre, reformatée en sortie de champ.
    const montant = page.getByLabel('Montant');
    await montant.fill('1250000,7');
    await expect(montant).toHaveAttribute('aria-invalid', 'true'); // décimales refusées pour un montant en CDF
    await montant.fill('1250000');
    await montant.blur();
    await expect(montant).toHaveValue(/^1\s250\s000$/u);
    await expect(page.getByText(/1\s250\s000 CDF/u)).toBeVisible();

    // Grille : dépassement signalé, Entrée passe à la ligne suivante, totaux recalculés.
    await expect(page.getByText(/Dépasse le plafond/)).toBeVisible();
    const cellule = page.getByLabel('Rémunérations — 2027 (CDF)');
    await cellule.fill('900000000');
    await cellule.press('Enter');
    await expect(page.getByLabel('Fonctionnement — 2027 (CDF)')).toBeFocused();
    await expect(page.getByText('Modifications non enregistrées')).toBeVisible();

    // Quitter avec une saisie non enregistrée : confirmation, puis on reste.
    await page.locator('nav[aria-label="Menu principal"] a').first().click();
    await expect(page.getByRole('dialog', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
    await page.getByRole('button', { name: 'Rester sur la page' }).click();
    await expect(page).toHaveURL(/\/composants/);
    await capture(page, 'saisie');

    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Aucune modification en attente.')).toBeVisible();
    expect(erreurs).toEqual([]);
  });

  test('fenêtre de formulaire, onglet dans l’adresse, affichage', async ({ page }) => {
    await connexion(page, 'cb.prg');
    await page.goto('/composants');
    await page.getByRole('tab', { name: 'Formulaires' }).click();
    await expect(page).toHaveURL(/onglet=formulaires/);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Formulaires' })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: 'Nouveau projet' }).click();
    const fenetre = page.getByRole('dialog', { name: 'Nouveau projet (démonstration)' });
    await fenetre.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('L’intitulé est obligatoire.')).toBeVisible(); // erreur de contrôle affichée, fenêtre ouverte
    await fenetre.getByLabel(/Intitulé/).fill('Projet fictif');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Abandonner la saisie ?' })).toBeVisible();
    await page.getByRole('button', { name: 'Annuler' }).last().click();
    await capture(page, 'formulaire');
    await fenetre.getByLabel(/Intitulé/).press('Enter');
    await expect(fenetre).toBeHidden();

    await page.getByRole('tab', { name: /Affichage/ }).click();
    await expect(page.getByRole('link', { name: /PTBA 2027 — Service des infrastructures/ })).toBeVisible();
    await expect(page.getByText(/En retard —/)).toBeVisible();
    await page.getByLabel('Province', { exact: true }).selectOption('Kinshasa');
    await expect(page.locator('main table tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'Effacer les filtres' }).click();
    await expect(page.locator('main table tbody tr')).toHaveCount(3);
    await capture(page, 'affichage');
  });

  test('onglet retrouvé au retour d’une fiche (Données sectorielles)', async ({ page }) => {
    await connexion(page, 'cd.edi');
    await page.goto('/donnees');
    await page.getByRole('tab', { name: 'Campagnes' }).click();
    await expect(page).toHaveURL(/onglet=campagnes/);
    await page.locator('main tbody tr').first().click();
    await page.waitForURL(/\/donnees\/campagnes\//);
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'Campagnes' })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Composants (téléphone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('onglets en liste déroulante et actions regroupées', async ({ page }) => {
    await connexion(page, 'cb.prg');
    await page.goto('/planification');
    const liste = page.getByRole('combobox', { name: 'Onglets' });
    await expect(liste).toBeVisible();
    await liste.selectOption('credits');
    await expect(page).toHaveURL(/onglet=credits/);

    await page.goto('/composants');
    await expect(page.getByRole('button', { name: 'Excel' })).toBeHidden();
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Excel' })).toBeVisible();
    await page.keyboard.press('Escape');
    const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(largeur).toBeLessThanOrEqual(390);
    await capture(page, 'telephone');
  });
});
