'use strict';
/**
 * Refonte, étape 5 — files « À traiter » du tableau de bord : chacun ne voit que ce qu’il peut
 * traiter, à l’étape où il intervient, et les compteurs du menu suivent les files. Données fictives.
 */
const { db, login, api, userId } = require('./helpers');

const A = 2061;
const files = async (a) => (await a.get('/dashboard/a-traiter')).body.files;
const file = async (a, cle) => (await files(a)).find((f) => f.cle === cle);
const contient = async (a, cle, to) => !!(await file(a, cle))?.items.some((i) => i.to === to);

describe('Files « À traiter »', () => {
  let prg; let cbprg; let cdps; let dir; let str; let sec; let cdedi;
  beforeAll(async () => {
    prg = api(await login('ag.prg1')); cbprg = api(await login('cb.prg')); cdps = api(await login('cd.ps')); dir = api(await login('directeur'));
    str = api(await login('ag.str1')); sec = api(await login('cb.secretariat')); cdedi = api(await login('cd.edi'));
  });

  test('programmation : chaque étape du circuit arrive dans la file de celui qui la traite', async () => {
    const doc = (await prg.post('/programmation/documents', { type: 'CDMT', annee: A })).body;
    const lien = `/planification/documents/${doc.id}`;
    expect(await contient(prg, 'programmation_brouillons', lien)).toBe(true);
    expect(await contient(cbprg, 'docs_verifier', lien)).toBe(false);
    expect((await prg.post(`/programmation/documents/${doc.id}/soumettre`)).status).toBe(200);
    expect(await contient(prg, 'programmation_brouillons', lien)).toBe(false);
    expect(await contient(cbprg, 'docs_verifier', lien)).toBe(true);
    // Ni le préparateur, ni un agent d’un autre Bureau, ni la Division ne voient la vérification.
    for (const autre of [prg, str, cdps]) expect(await contient(autre, 'docs_verifier', lien)).toBe(false);
    // Les compteurs du menu suivent les files.
    expect((await cbprg.get('/dashboard/compteurs')).body.planification).toBeGreaterThanOrEqual(1);
    expect((await str.get('/dashboard/compteurs')).body.planification).toBe(0);

    await cbprg.post(`/programmation/documents/${doc.id}/retourner`, { motif: 'Compléter les projections (essai).' });
    expect(await contient(prg, 'programmation_corriger', lien)).toBe(true);
    await prg.post(`/programmation/documents/${doc.id}/soumettre`);
    await cbprg.post(`/programmation/documents/${doc.id}/verifier`);
    expect(await contient(cbprg, 'docs_verifier', lien)).toBe(false);
    expect(await contient(cdps, 'docs_consolider', lien)).toBe(true);
    await cdps.post(`/programmation/documents/${doc.id}/consolider`);
    expect(await contient(dir, 'docs_valider', lien)).toBe(true);
    await dir.post(`/programmation/documents/${doc.id}/valider`);
    expect(await contient(dir, 'docs_valider', lien)).toBe(false);
  });

  test('réunions : convocation, déclaration de tenue, rédaction et validation du compte rendu', async () => {
    const debut = new Date(Date.now() + 2 * 86400000).toISOString();
    const r = (await sec.post('/reunions', { objet: 'Réunion des files (essai)', debut, pour_directeur: true, participants: [await userId('cd.ps')] })).body;
    const lien = `/reunions/${r.id}`;
    expect(await contient(sec, 'reunions_convoquer', lien)).toBe(true);
    expect(await contient(cdps, 'reunions_convoquer', lien)).toBe(false);
    await sec.post(`/reunions/${r.id}/convoquer`);
    expect(await contient(sec, 'reunions_tenir', lien)).toBe(false); // pas encore commencée
    await db('reunions').where({ id: r.id }).update({ debut: new Date(Date.now() - 3600000) });
    expect(await contient(sec, 'reunions_tenir', lien)).toBe(true);
    expect(await contient(dir, 'reunions_tenir', lien)).toBe(false); // le président n’a pas cette file
    await sec.post(`/reunions/${r.id}/tenue`);
    expect(await contient(sec, 'cr_rediger', lien)).toBe(true);
    await sec.put(`/reunions/${r.id}/compte-rendu`, { compte_rendu: 'Compte rendu (essai).', decisions: [] });
    await sec.post(`/reunions/${r.id}/soumettre-cr`);
    expect(await contient(sec, 'cr_rediger', lien)).toBe(false);
    expect(await contient(dir, 'cr_valider', lien)).toBe(true);
  });

  test('décisions : le responsable voit les siennes à mettre en œuvre, pas les autres', async () => {
    const d = (await dir.post('/decisions', { libelle: 'Décision des files (essai)', responsable_user_id: await userId('cd.edi') })).body;
    expect(await contient(cdedi, 'decisions_executer', `/decisions/${d.id}`)).toBe(true);
    expect(await contient(cdps, 'decisions_executer', `/decisions/${d.id}`)).toBe(false);
  });

  test('une file vide n’est pas renvoyée ; chaque élément a un lien', async () => {
    const f = await files(str);
    expect(f.every((x) => x.total > 0 && x.items.length > 0 && x.items.length <= 5)).toBe(true);
    expect(f.flatMap((x) => x.items).every((i) => i.to.startsWith('/'))).toBe(true);
  });
});
