// Accessibilité hors du parcours par rôle : pages publiques, utilisation au clavier (lien d’évitement,
// tiroir du menu sur téléphone, fenêtres) et fenêtres ouvertes analysées par axe-core (WCAG 2.1 AA).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { connexion } from './outils';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const violations = async (page, zone) => {
  const axe = new AxeBuilder({ page }).withTags(TAGS);
  if (zone) axe.include(zone);
  return (await axe.analyze()).violations.map((v) => `${v.id} : ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
};

for (const [format, viewport] of Object.entries({ ordinateur: { width: 1366, height: 900 }, telephone: { width: 390, height: 844 } })) {
  test.describe(`Pages publiques (${format})`, () => {
    test.use({ viewport });
    test('connexion et vérification des cartes sans violation', async ({ page }) => {
      await page.goto('/connexion');
      await expect(page.locator('#username')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.goto('/verification');
      await expect(page.getByRole('heading').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}

test.describe('Clavier (ordinateur)', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('lien « Aller au contenu » en première tabulation, puis focus sur le contenu', async ({ page }) => {
    await connexion(page, 'cb.prg');
    await page.goto('/planification');
    await expect(page.locator('main h1').first()).toBeVisible();
    // Premier élément atteignable au clavier de la page, visible dès qu’il reçoit le focus.
    const premier = await page.evaluate(() => [...document.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')][0]?.textContent.trim());
    expect(premier).toBe('Aller au contenu');
    const lien = page.getByRole('link', { name: 'Aller au contenu' });
    await lien.focus();
    await expect(lien).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#contenu')).toBeFocused();
  });

  test('fenêtres de saisie et de confirmation : focus, Échap, aucune violation', async ({ page }) => {
    await connexion(page, 'cb.prg');
    await page.goto('/composants?onglet=formulaires');
    const ouvrir = page.getByRole('button', { name: 'Nouveau projet' });
    await ouvrir.click();
    const fenetre = page.getByRole('dialog', { name: 'Nouveau projet (démonstration)' });
    await expect(fenetre).toBeVisible();
    await expect(fenetre.getByLabel(/Intitulé/)).toBeFocused(); // premier champ
    expect(await violations(page, '[role="dialog"]')).toEqual([]);
    // Tab reste dans la fenêtre.
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
    expect(await fenetre.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(fenetre).toBeHidden();
    await expect(ouvrir).toBeFocused(); // retour du focus au bouton d’origine
  });
});

test.describe('Clavier (téléphone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tiroir du menu : ouverture, focus piégé, Échap, retour du focus', async ({ page }) => {
    await connexion(page, 'cd.edi');
    const bouton = page.getByRole('button', { name: 'Ouvrir le menu' });
    await bouton.click();
    const tiroir = page.getByRole('dialog', { name: 'Menu principal' });
    await expect(tiroir).toBeVisible();
    await expect(tiroir.getByRole('button', { name: 'Fermer le menu' })).toBeFocused();
    expect(await violations(page, '[role="dialog"]')).toEqual([]);
    await page.keyboard.press('Shift+Tab');
    expect(await tiroir.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(tiroir).toBeHidden();
    await expect(bouton).toBeFocused();
    // Le bandeau « À traiter » tient dans la largeur du téléphone.
    await expect(page.getByRole('region', { name: 'À traiter' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  });
});
