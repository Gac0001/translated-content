// Parcours des fiches de détail : depuis chaque liste, ouverture de la première fiche.
// Échoue si la fiche lève une erreur JavaScript, affiche une erreur d’API ou n’a pas de titre.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

// [rôle, page de liste, onglet éventuel] — les cartes de service ne figurent pas dans la démonstration.
const PARCOURS = {
  directeur: [['/reunions'], ['/decisions'], ['/actes'], ['/demandes-information'], ['/instructions'], ['/taches'], ['/courriers'], ['/documents'], ['/pip'], ['/personnel'], ['/presences']],
  'cb.prg': [['/planification', 'PTBA'], ['/planification', 'CBMT']],
  'cd.edi': [['/donnees', 'Annuaire'], ['/donnees', 'Campagnes'], ['/donnees', 'Questionnaires'], ['/donnees', 'Indicateurs'], ['/donnees', 'Bulletins']],
  admin: [['/comptes']],
};

test.use({ viewport: { width: 1366, height: 900 } });
for (const [role, listes] of Object.entries(PARCOURS)) {
  test(`${role} : les fiches s’ouvrent sans erreur`, async ({ page }) => {
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(`JS : ${e.message}`));
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) erreurs.push(`API ${r.status()} : ${r.url()}`); });
    await connexion(page, role);
    const dossier = path.resolve('e2e/captures/fiches', role.replace(/\./g, '-'));
    fs.mkdirSync(dossier, { recursive: true });
    for (const [liste, onglet] of listes) {
      await page.goto(liste);
      if (onglet) await page.click(`button[role=tab]:has-text("${onglet}")`);
      await page.waitForLoadState('networkidle').catch(() => {});
      const ligne = page.locator('main tbody tr').first();
      await expect(ligne, `aucune ligne dans ${liste} ${onglet || ''}`).toBeVisible({ timeout: 15000 });
      const avant = page.url();
      await ligne.click();
      await page.waitForURL((u) => u.href !== avant, { timeout: 15000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.locator('main h1').first(), `titre de ${page.url()}`).toBeVisible({ timeout: 15000 });
      const alerte = await page.locator('main [role=alert]').allInnerTexts();
      expect(alerte.filter((t) => t.trim()), `erreur affichée sur ${page.url()}`).toEqual([]);
      expect(erreurs, `erreurs sur ${page.url()}`).toEqual([]);
      await page.screenshot({ path: path.join(dossier, `${new URL(page.url()).pathname.slice(1).replace(/\//g, '_')}.png`), fullPage: true });
    }
  });
}
