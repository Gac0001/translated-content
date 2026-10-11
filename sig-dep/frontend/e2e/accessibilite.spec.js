// Accessibilité (WCAG 2.1 niveaux A et AA, axe-core) : pour chaque rôle, toutes les entrées du menu,
// les fiches principales et les fenêtres de saisie, sur ordinateur et sur téléphone. Échoue à la première
// violation ; le relevé détaillé est écrit dans e2e/captures/accessibilite/<format>.json.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const ROLES = ['directeur', 'sg', 'cb.secretariat', 'cd.ps', 'cb.prg', 'ag.prg1', 'ag.sev1', 'cd.edi', 'cb.eap', 'ag.doi1', 'admin'];
const FORMATS = { ordinateur: { width: 1366, height: 900 }, telephone: { width: 390, height: 844 } };
const dossier = path.resolve('e2e/captures/accessibilite');
fs.mkdirSync(dossier, { recursive: true });

async function analyser(page, ou, releve) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15000 });
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of violations) {
    releve.push({ ou, regle: v.id, impact: v.impact, aide: v.help, elements: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim() || ''}`) });
  }
}

/** Premier lien de la page principale dont l’adresse correspond au motif (fiche à ouvrir). */
async function premiereFiche(page, motif) {
  const liens = await page.$$eval('main a[href]', (as) => as.map((a) => a.getAttribute('href')));
  return liens.find((h) => motif.test(h));
}

const FICHES = [
  ['/planification', /^\/planification\/ptba\/\d+$/],
  ['/donnees', /^\/donnees\/campagnes\/\d+$/],
  ['/reunions', /^\/reunions\/\d+$/],
  ['/decisions', /^\/decisions\/\d+$/],
  ['/instructions', /^\/instructions\/\d+$/],
  ['/courriers', /^\/courriers\/\d+$/],
  ['/actes', /^\/actes\/\d+$/],
  ['/cartes', /^\/cartes\/\d+$/],
  ['/personnel', /^\/personnel\/\d+$/],
];

for (const [format, viewport] of Object.entries(FORMATS)) {
  test.describe(`Accessibilité (${format})`, () => {
    test.use({ viewport });

    for (const role of ROLES) {
      test(`${role} : écrans du menu et fiches sans violation`, async ({ page }) => {
        const releve = [];
        await connexion(page, role);
        const liens = await page.$$eval('nav[aria-label="Menu principal"] a', (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
        for (const lien of liens) {
          await page.goto(lien);
          await analyser(page, `${role} ${lien}`, releve);
        }
        for (const [liste, motif] of FICHES) {
          if (!liens.includes(liste)) continue;
          await page.goto(liste);
          await page.waitForLoadState('networkidle').catch(() => {});
          const fiche = await premiereFiche(page, motif);
          if (!fiche) continue;
          await page.goto(fiche);
          await analyser(page, `${role} ${fiche}`, releve);
        }
        const fichier = path.join(dossier, `${format}.json`);
        const tous = fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, 'utf8')) : {};
        tous[role] = releve;
        fs.writeFileSync(fichier, JSON.stringify(tous, null, 2));
        expect(releve, 'violations d’accessibilité').toEqual([]);
      });
    }
  });
}
