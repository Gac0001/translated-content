// Parcours de non-régression : pour chaque rôle, connexion puis visite de toutes les entrées du menu,
// sur ordinateur et sur téléphone. Échoue si une page lève une erreur JavaScript, affiche une erreur
// d’API ou n’a pas de titre. Enregistre une capture de chaque écran (e2e/captures/<format>/<rôle>/)
// et un relevé des débordements horizontaux (e2e/captures/<format>/debordements.json).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connexion } from './outils';

const ROLES = ['directeur', 'sg', 'cb.secretariat', 'cd.ps', 'cb.prg', 'ag.prg1', 'ag.sev1', 'cd.edi', 'cb.eap', 'ag.doi1', 'admin'];
const FORMATS = { ordinateur: { width: 1366, height: 900 }, telephone: { width: 390, height: 844 } };
const CAPTURES = path.resolve('e2e/captures');


for (const [format, viewport] of Object.entries(FORMATS)) {
  test.describe(`Navigation (${format})`, () => {
    test.use({ viewport });
    for (const role of ROLES) {
      test(`${role} : toutes les entrées du menu s’affichent sans erreur`, async ({ page }) => {
        const erreurs = [];
        page.on('pageerror', (e) => erreurs.push(`JS : ${e.message}`));
        page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) erreurs.push(`API ${r.status()} : ${r.url()}`); });
        await connexion(page, role);
        const liens = await page.$$eval('nav[aria-label="Menu principal"] a', (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
        expect(liens.length).toBeGreaterThan(0);
        const dossier = path.join(CAPTURES, format, role.replace(/\./g, '-'));
        fs.mkdirSync(dossier, { recursive: true });
        const debordements = [];
        for (const lien of liens) {
          const avant = erreurs.length;
          await page.goto(lien);
          await page.waitForLoadState('networkidle').catch(() => {});
          await expect(page.locator('main h1').first(), `titre de ${lien}`).toBeVisible({ timeout: 15000 });
          const alerte = await page.locator('main [role=alert]').allInnerTexts();
          expect(alerte.filter((t) => t.trim()), `erreur affichée sur ${lien}`).toEqual([]);
          expect(erreurs.slice(avant), `erreurs sur ${lien}`).toEqual([]);
          const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
          if (largeur > viewport.width + 1) debordements.push({ lien, largeur, viewport: viewport.width });
          await page.screenshot({ path: path.join(dossier, `${(lien === '/' ? 'accueil' : lien.slice(1)).replace(/\//g, '_')}.png`), fullPage: true });
        }
        const releve = path.join(CAPTURES, format, 'debordements.json');
        const tous = fs.existsSync(releve) ? JSON.parse(fs.readFileSync(releve, 'utf8')) : {};
        tous[role] = debordements;
        fs.writeFileSync(releve, JSON.stringify(tous, null, 2));
        test.info().annotations.push({ type: 'débordements', description: debordements.length ? debordements.map((d) => `${d.lien} (${d.largeur}px)`).join(', ') : 'aucun' });
      });
    }
  });
}
