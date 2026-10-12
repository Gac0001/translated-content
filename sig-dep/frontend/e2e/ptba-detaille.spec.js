// PTBA en vue budgétaire détaillée : lignes de dépense, rapport d’anomalies, import d’un classeur
// contenant une feuille d’un autre ministère (données fictives).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { connexion } from './outils';

const require = createRequire(import.meta.url);
const dossier = path.resolve('e2e/captures/ptba');
fs.mkdirSync(dossier, { recursive: true });
const capture = (page, nom) => page.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: true });

/** Classeur fictif : une feuille en vue détaillée et une feuille masquée d’un autre ministère. */
async function classeur() {
  const ExcelJS = require('../../backend/node_modules/exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DCS');
  ws.getRow(1).values = ['Désignation', null, null, 'Structure destinataire', 'Nature économique', 'Section/Chapitre', 'Unité physique', 'Chronogramme', ...Array(11).fill(null), 'Coût en FC', null, 'Lieu d\'exécution', 'Mode de gestion'];
  ws.getRow(2).values = [null, null, null, null, null, null, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 'Coût', 'Source'];
  const put = (r, cells) => Object.entries(cells).forEach(([c, v]) => { ws.getCell(`${c}${r}`).value = v; });
  put(4, { A: 'MINISTERE DE L’ECONOMIE NUMERIQUE' }); put(5, { A: 'PROGRAMME 3 : Programme d’essai' });
  put(6, { A: 'ACTION 1 : Action d’essai' }); put(7, { A: 'ACTIVITÉ 1 : Activité d’essai' }); put(8, { A: 'Tâche 1 : Tâche d’essai' });
  put(9, { A: 'Fournitures', D: 'DCS', T: '100 000 00', H: 'X' }); put(10, { A: 'Prestations', D: 'DCS', T: 2000000, I: 'X' });
  const autre = wb.addWorksheet('Feuil9', { state: 'hidden' });
  autre.getCell('A2').value = 'Ministère: Transports (fictif)';
  autre.getRow(6).values = ['N°', 'Activités principales', 'Tâches', 'Coût', 'Chronogramme', '', '', '', '', '', '', '', '', '', '', '', 'Structures Responsable'];
  autre.getRow(7).values = ['N°', 'Activités principales', 'Tâches', 'Coût', 'T1']; autre.getRow(8).values = ['N°', 'Activités principales', 'Tâches', 'Coût', 'J'];
  ['Office (fictif)', 'Société (fictive)', 'Régie (fictive)'].forEach((x, i) => { autre.getRow(9 + i).values = [i + 1, `Activité ${i + 1}`, 'Tâche', 1000, ...Array(12).fill(null), x]; });
  const fichier = path.join(dossier, 'ptba-essai.xlsx');
  await wb.xlsx.writeFile(fichier);
  return fichier;
}

test.describe('PTBA — vue budgétaire détaillée (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('fiche : lignes de dépense, rapport d’anomalies, édition des dépenses', async ({ page }) => {
    await connexion(page, 'ag.prg1');
    await page.goto('/planification');
    await page.getByLabel('Exercice').selectOption(String(new Date().getFullYear()));
    await page.locator('main tbody tr', { hasText: 'DCS' }).first().click();
    await page.waitForURL(/\/planification\/ptba\//);
    await expect(page.getByText(/vue budgétaire détaillée/).first()).toBeVisible();
    await expect(page.getByRole('table', { name: 'Anomalies de l’import' })).toBeVisible();
    await page.getByText('3 ligne(s) de dépense').click();
    await expect(page.getByText('Fournitures et petits matériels')).toBeVisible();
    await capture(page, 'ptba-detaille');
    await page.getByRole('button', { name: 'Modifier' }).click();
    await expect(page.getByLabel(/^Désignation, ligne de dépense 1 \(Tâche 1\.1/)).toHaveValue('Primes et indemnités non permanentes');
    await expect(page.getByRole('textbox', { name: 'Coût en CDF' }).first()).toBeDisabled();
  });

  test('import : feuille d’un autre ministère non retenue, rapport d’anomalies affiché', async ({ page }) => {
    const fichier = await classeur();
    await connexion(page, 'ag.prg1');
    await page.goto('/planification');
    await page.getByRole('button', { name: /Importer/ }).first().click();
    const dialogue = page.getByRole('dialog', { name: /Importer un PTBA/ });
    await dialogue.locator('input[type=file]').setInputFiles(fichier);
    const autre = dialogue.locator('li', { hasText: 'Feuil9' });
    await expect(autre.getByText(/Feuille d’un autre ministère/)).toBeVisible();
    await expect(autre.getByRole('checkbox')).not.toBeChecked();
    await expect(autre.getByText('Masquée', { exact: true })).toBeVisible();
    const dcs = dialogue.locator('li', { hasText: 'DCS' });
    await expect(dcs.getByText('Vue détaillée')).toBeVisible();
    await dcs.getByText(/Rapport d’anomalies : 1 erreur/).click();
    await expect(dcs.getByText(/mal saisi « 100 000 00 »/)).toBeVisible();
    await capture(page, 'import-anomalies');
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
  });
});
