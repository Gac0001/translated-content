// Étape 5 : liste « À traiter » des tableaux de bord et compteurs du menu (démonstration, rien n’est enregistré).
// Direction B (1.47.0) : les files sont réunies en une seule liste, avec un filtre par file.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const dossier = path.resolve('e2e/captures/a-traiter');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });
const bandeau = (page) => page.getByRole('region', { name: 'À traiter' });
/** Filtre d’une file dans la liste « À traiter » (une seule file : pas de filtres, son nom figure sur chaque ligne). */
const file = (page, nom) => bandeau(page).getByRole('group', { name: 'Filtrer les éléments à traiter' }).getByRole('button', { name: nom })
  .or(bandeau(page).getByRole('listitem').getByText(nom)).first();

test.use({ viewport: { width: 1366, height: 900 } });

test('Chef du Bureau Programme : PTBA à vérifier, ouverture depuis la file, compteur du menu', async ({ page }) => {
  await connexion(page, 'cb.prg');
  await expect(file(page, /PTBA à vérifier/)).toBeVisible();
  await file(page, /PTBA à vérifier/).click();
  await expect(bandeau(page).getByText(/Dépassements des plafonds du CBMT/).first()).toBeVisible();
  await expect(page.locator('aside nav').getByRole('link', { name: /PTBA et exécution.*à traiter/ })).toBeVisible();
  await capture(page, 'cb-prg');
  await bandeau(page).getByRole('link', { name: /PTBA 20\d\d — / }).first().click();
  await expect(page).toHaveURL(/\/planification\/ptba\/\d+$/);
  await expect(page.getByRole('region', { name: 'Circuit de traitement' }).getByRole('button', { name: 'Vérifié' })).toBeVisible();
});

test('Chef de Division EDI : bulletin à viser et réponses à contrôler', async ({ page }) => {
  await connexion(page, 'cd.edi');
  await expect(file(page, /Bulletins à viser/)).toBeVisible();
  await expect(file(page, /Réponses à contrôler/)).toBeVisible();
  await capture(page, 'cd-edi');
});

test('Agent de saisie : son brouillon en erreur ; Secrétariat : réunion à déclarer tenue', async ({ page }) => {
  await connexion(page, 'ag.doi1');
  await expect(file(page, /Mes brouillons à transmettre/)).toBeVisible();
  await expect(bandeau(page).getByText(/erreur\(s\)/).first()).toBeVisible();
  await capture(page, 'ag-doi1');
  await page.context().clearCookies();
  await connexion(page, 'cb.secretariat');
  await expect(file(page, /Réunions passées à déclarer tenues/)).toBeVisible();
  await capture(page, 'cb-secretariat');
});

test('Rien à traiter : une seule ligne', async ({ page }) => {
  await connexion(page, 'ag.str1');
  await expect(bandeau(page)).toBeVisible();
  // Soit la ligne « Rien à traiter », soit la liste des éléments, une fois les files chargées.
  await expect(bandeau(page).getByText('Rien à traiter dans les circuits pour le moment.')
    .or(bandeau(page).getByRole('list')).first()).toBeVisible();
});
