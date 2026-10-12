// Fiche PIP au modèle du Ministère du Plan : formulaire en huit étapes, import d’un classeur, référentiels.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { connexion } from './outils';

const require = createRequire(import.meta.url);
const dossier = path.resolve('e2e/captures/pip');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

test.describe('Fiche PIP (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('nouvelle fiche : huit étapes, rubriques du modèle, suggestions, coût et financement', async ({ page }) => {
    await connexion(page, 'ag.coi1');
    await page.goto('/pip/nouveau');
    const etapes = page.getByRole('navigation', { name: 'Étapes de la fiche' }).getByRole('button');
    await expect(etapes).toHaveCount(8);
    await page.getByLabel('Libellé du projet').fill('Projet de saisie (essai)');
    await expect(page.locator('datalist option[value="Direction Cybersécurité (DCS)"]')).toHaveCount(1); // service (étape 1)
    await etapes.filter({ hasText: 'Aspect financier' }).click();
    await expect(page.getByText('Construction/réhabilitation', { exact: true })).toBeVisible();
    await page.getByLabel('Année 1, ligne 1 (Etudes)').fill('1000000');
    await expect(page.getByRole('status').filter({ hasText: 'Écart à résorber' })).toBeVisible();
    await capture(page, 'formulaire-financier');
  });

  test('import d’un classeur au modèle du Plan : relecture puis brouillon', async ({ page }) => {
    const { exporter } = require('../../backend/src/services/pipExcel.js');
    const fichier = path.join(dossier, 'fiche-import.xlsx');
    fs.writeFileSync(fichier, Buffer.from(await exporter({
      identification: { libelle: 'Projet importé (essai)', service: 'Direction Cybersécurité (DCS)', province: 'Kinshasa' },
      calendrier: { date_debut: '2027-01-01', date_fin: '2027-12-31' },
      financier: { couts: [{ rubrique: 'Etudes', annee1: 500000 }], financement: [{ source: 'Etat', annee1: 500000 }] },
    }, { adresse: 'Adresse' })));
    await connexion(page, 'ag.coi1');
    await page.goto('/pip');
    await page.getByRole('button', { name: 'Importer une fiche' }).click();
    const dialogue = page.getByRole('dialog', { name: /Importer une fiche/ });
    await dialogue.locator('input[type=file]').setInputFiles(fichier);
    await dialogue.getByRole('button', { name: 'Lire le classeur' }).click();
    await expect(dialogue.getByText('Projet importé (essai)')).toBeVisible();
    await expect(dialogue.getByText(/rubrique\(s\) obligatoire\(s\) à compléter/)).toBeVisible();
    await capture(page, 'import-relecture');
    await dialogue.getByRole('button', { name: 'Créer le brouillon' }).click();
    await expect(page).toHaveURL(/\/pip\/\d+\/modifier$/);
    await expect(page.getByLabel('Libellé du projet')).toHaveValue('Projet importé (essai)');
  });

  test('fiche validée : synthèse financière par année ; référentiels PNSD et stratégie', async ({ page }) => {
    await connexion(page, 'directeur');
    await page.goto('/pip');
    await page.getByRole('row', { name: /Backbone national/ }).first().click();
    await expect(page.getByRole('table', { name: 'Synthèse financière' })).toBeVisible();
    await capture(page, 'fiche-validee');
    await page.goto('/planification?onglet=referentiel');
    await expect(page.getByRole('heading', { name: /Rattachement au PNSD/ })).toBeVisible();
    await expect(page.getByText('Pilier de démonstration : gouvernance')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Services du Secrétariat Général' })).toBeVisible();
    await capture(page, 'referentiels');
  });
});
