'use strict';
/**
 * Lot 9B — Cadre de performance, crédits, documents de programmation (PAP, RAP, CDMT),
 * banque des projets, jalons et risques. Données fictives.
 */
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const { db, login, api, userId } = require('./helpers');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
const texteDocx = async (buf) => (await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Programmation et performance', () => {
  let prg; let sev; let cbprg; let cdps; let dir; let programme; let action; let indicateur; let pap;
  const A = 2031;
  beforeAll(async () => {
    prg = api(await login('ag.prg2')); sev = api(await login('ag.sev2')); cbprg = api(await login('cb.prg'));
    cdps = api(await login('cd.ps')); dir = api(await login('directeur'));
    programme = (await prg.post('/planification/programmes', { code: '71', libelle: 'Programme de performance', objectif_global: 'Mesurer la performance' })).body;
    action = (await prg.post('/planification/actions', { programme_id: programme.id, code: '1', libelle: 'Action de pilotage', services_normatifs: 'DEP', operateurs: '—' })).body;
  });

  test('cadre de performance : objectifs, indicateurs, cibles (Programme) et réalisations (Suivi-Évaluation)', async () => {
    expect((await sev.post('/programmation/objectifs', { libelle: 'Interdit' })).status).toBe(403);
    const om = await prg.post('/programmation/objectifs', { libelle: 'Améliorer la gouvernance du numérique' });
    const op = await prg.post('/programmation/objectifs', { programme_id: programme.id, libelle: 'Renforcer le pilotage' });
    expect(om.body.programme_id).toBeNull();
    indicateur = (await prg.post('/programmation/indicateurs', { objectif_id: om.body.id, libelle: 'Taux d’implémentation du cadre institutionnel', unite: '%', mode_calcul: 'Organes implémentés / prévus × 100', source: 'DEP' })).body;
    await prg.post('/programmation/indicateurs', { objectif_id: op.body.id, libelle: 'Nombre de revues de performance', unite: 'Nombre' });
    // Cibles : Programme ; réalisations : Suivi-Évaluation
    expect((await sev.put(`/programmation/indicateurs/${indicateur.id}/valeurs`, { annee: A, type: 'CIBLE', valeur: 50 })).status).toBe(403);
    expect((await prg.put(`/programmation/indicateurs/${indicateur.id}/valeurs`, { annee: A, type: 'CIBLE', valeur: 50 })).status).toBe(200);
    for (const [an, v] of [[A - 4, 12.5], [A - 3, 12.5], [A - 2, 25]]) await sev.put(`/programmation/indicateurs/${indicateur.id}/valeurs`, { annee: an, type: 'REALISATION', valeur: v });
    await sev.put(`/programmation/indicateurs/${indicateur.id}/valeurs`, { annee: A - 1, type: 'REALISATION_S1', valeur: 37.5 });
    await prg.put(`/programmation/indicateurs/${indicateur.id}/valeurs`, { annee: A + 1, type: 'CIBLE', valeur: 75 });
    const c = (await api(await login('ag.str1')).get(`/programmation/cadre?annee=${A}`)).body;
    expect(c.droits).toEqual({ saisir: false, suivre: false });
    const i = c.objectifsMinistere.flatMap((o) => o.indicateurs).find((x) => x.id === indicateur.id);
    expect(i.valeurs).toMatchObject({ [`CIBLE:${A}`]: { valeur: 50 }, [`REALISATION:${A - 2}`]: { valeur: 25 }, [`REALISATION_S1:${A - 1}`]: { valeur: 37.5 } });
    // Effacement d’une valeur
    await prg.put(`/programmation/indicateurs/${indicateur.id}/valeurs`, { annee: A + 1, type: 'CIBLE', valeur: null });
    expect(await db('plan_indicateur_valeurs').where({ indicateur_id: indicateur.id, annee: A + 1 }).first()).toBeUndefined();
  });

  test('crédits par programme, action, rubrique et titre', async () => {
    const r = (await prg.get(`/programmation/credits?annee=${A}`)).body;
    const rem = r.postes.find((p) => p.code === 'REM'); const fonc = r.postes.find((p) => p.code === 'FONC'); const t3 = r.postes.find((p) => p.code === 'T3');
    expect((await sev.put('/programmation/credits', { lignes: [{ annee: A, programme_id: programme.id, poste_id: rem.id, type: 'VOTE', montant: 1 }] })).status).toBe(403);
    const lignes = [
      { annee: A - 2, programme_id: programme.id, poste_id: rem.id, type: 'VOTE', montant: 800000000 },
      { annee: A - 2, programme_id: programme.id, poste_id: rem.id, type: 'EXECUTE', montant: 760000000 },
      { annee: A, programme_id: programme.id, poste_id: rem.id, type: 'PREVISION', montant: 900000000 },
      { annee: A, programme_id: programme.id, poste_id: fonc.id, type: 'PREVISION', montant: 300000000 },
      { annee: A, programme_id: programme.id, action_id: action.id, poste_id: fonc.id, type: 'PREVISION', montant: 300000000 },
      { annee: A, programme_id: programme.id, poste_id: t3.id, type: 'PREVISION', montant: 900000000 },
      { annee: A, programme_id: programme.id, poste_id: rem.id, type: 'VOTE', montant: 850000000 },
      { annee: A, programme_id: programme.id, poste_id: rem.id, type: 'EXECUTE', montant: 680000000 },
      { annee: A + 1, programme_id: programme.id, poste_id: rem.id, type: 'PREVISION', montant: 950000000 },
    ];
    expect((await prg.put('/programmation/credits', { lignes })).body.enregistres).toBe(lignes.length);
    // Ressaisie : remplace ; null efface
    await prg.put('/programmation/credits', { lignes: [{ ...lignes[2], montant: 910000000 }, { ...lignes[8], montant: null }] });
    const apres = await db('plan_credits').where({ programme_id: programme.id });
    expect(apres).toHaveLength(lignes.length - 1);
    expect(Number(apres.find((x) => x.annee === A && x.type === 'PREVISION' && x.poste_id === rem.id && !x.action_id).montant)).toBe(910000000);
    expect((await prg.put('/programmation/credits', { lignes: [{ ...lignes[4], action_id: 999999 }] })).status).toBe(400);
  });

  test('PAP : rédaction, circuit, export Word au plan du Ministère ; RAP et CDMT', async () => {
    const d = await prg.post('/programmation/documents', { type: 'PAP', annee: A });
    expect(d.status).toBe(201);
    pap = d.body;
    expect((await prg.post('/programmation/documents', { type: 'PAP', annee: A })).status).toBe(409);
    const contenu = {
      ministere: 'ÉCONOMIE NUMÉRIQUE', section: '71', missions: 'Concevoir la politique du numérique.', organisation: 'Cabinet, Secrétariat Général, directions.',
      performances_anterieures: 'Cadre légal adopté.', perspectives: 'Opérationnaliser les organes.', programmes: { [programme.id]: { perimetre: 'Services de pilotage.', strategie: 'Renforcer la coordination.' } },
    };
    expect((await prg.put(`/programmation/documents/${pap.id}`, { contenu })).status).toBe(200);
    const x = await binaire(prg.get(`/programmation/documents/${pap.id}/export`));
    expect(x.status).toBe(200);
    const t = await texteDocx(x.body);
    for (const attendu of ['PROJET ANNUEL DE PERFORMANCE 2031', 'Maquette programmatique', 'Programme 71 : Programme de performance', 'Action de pilotage',
      'Taux d’implémentation du cadre institutionnel', '12,5', '37,5', 'Évolution des crédits par rubrique budgétaire', '910 000 000', 'Renforcer la coordination', 'Titre III : Dépenses de personnel']) {
      expect(t).toContain(attendu);
    }
    // Circuit
    await prg.post(`/programmation/documents/${pap.id}/soumettre`);
    expect((await prg.post(`/programmation/documents/${pap.id}/verifier`)).status).toBe(403);
    await cbprg.post(`/programmation/documents/${pap.id}/verifier`);
    await cdps.post(`/programmation/documents/${pap.id}/consolider`);
    expect((await api(await login('sg')).get(`/programmation/documents/${pap.id}`)).status).toBe(403);
    expect((await dir.post(`/programmation/documents/${pap.id}/valider`)).body.statut).toBe('VALIDE');
    expect((await api(await login('sg')).get(`/programmation/documents/${pap.id}`)).status).toBe(200);
    await expect(db('plan_documents').where({ id: pap.id }).update({ contenu: '{}' })).rejects.toThrow(/DOCUMENT_VERROUILLE/);
    // RAP de l’exercice : cible et réalisation, taux d’atteinte, exécution budgétaire
    await sev.put(`/programmation/indicateurs/${indicateur.id}/valeurs`, { annee: A, type: 'REALISATION', valeur: 40, commentaire: 'Deux organes installés' });
    const rap = (await prg.post('/programmation/documents', { type: 'RAP', annee: A })).body;
    const tr = await texteDocx((await binaire(prg.get(`/programmation/documents/${rap.id}/export`))).body);
    expect(tr).toContain('RAPPORT ANNUEL DE PERFORMANCE 2031');
    expect(tr).toContain('80 %'); // 40 / 50
    expect(tr).toContain('Deux organes installés');
    expect(tr).toContain('80 %'); // 680 / 850 millions
    // CDMT
    const cd = (await prg.post('/programmation/documents', { type: 'CDMT', annee: A })).body;
    const xc = await binaire(prg.get(`/programmation/documents/${cd.id}/export`));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xc.body);
    const ws = wb.worksheets[0];
    const total = ws.getRow(ws.rowCount);
    expect(total.getCell(1).value).toBe('TOTAL MINISTÈRE');
    expect(Number(total.getCell(4).value)).toBe(1210000000);
  });

  test('banque des projets, jalons et registre des risques', async () => {
    const pip = await db('pip_projects').whereNot('statut', 'BROUILLON').first();
    expect((await prg.get('/programmation/banque')).body.data.map((p) => p.id)).toContain(pip.id);
    expect((await api(await login('ag.str1')).put(`/programmation/banque/${pip.id}`, { maturite: 'PRET' })).status).toBe(403);
    expect((await sev.put(`/programmation/banque/${pip.id}`, { maturite: 'EN_COURS', programme_id: programme.id, localisation: 'Kinshasa' })).body.maturite).toBe('EN_COURS');
    await sev.post(`/programmation/banque/${pip.id}/jalons`, { libelle: 'Études de faisabilité', date_prevue: '2020-06-30' });
    const j = await sev.post(`/programmation/banque/${pip.id}/jalons`, { libelle: 'Lancement des travaux', date_prevue: '2099-01-15' });
    expect((await sev.put(`/programmation/jalons/${j.body.id}`, { ...j.body, date_realisee: '2026-01-20' })).body.date_realisee).toBe('2026-01-20');
    const b = (await prg.get('/programmation/banque')).body.data.find((p) => p.id === pip.id);
    expect(b).toMatchObject({ jalons: 2, jalons_en_retard: 1, programme_libelle: 'Programme de performance' });
    expect((await sev.post('/programmation/risques', { entity_type: 'PIP', entity_id: 999999, libelle: 'X', probabilite: 1, impact: 1 })).status).toBe(400);
    const r = await sev.post('/programmation/risques', { entity_type: 'PIP', entity_id: pip.id, libelle: 'Retard de décaissement des fonds', probabilite: 3, impact: 3, mesures: 'Plaidoyer auprès des Finances', responsable: 'DEP' });
    expect(r.status).toBe(201);
    expect(await db('notifications').where({ user_id: await userId('directeur') }).where('titre', 'like', 'Risque critique%').first()).toBeTruthy();
    await sev.post('/programmation/risques', { entity_type: 'PROGRAMME', entity_id: programme.id, libelle: 'Faible mobilisation des partenaires', probabilite: 2, impact: 2 });
    const liste = (await dir.get('/programmation/risques')).body.data;
    const crit = liste.find((x) => x.id === r.body.id);
    expect(crit).toMatchObject({ criticite: 9, objet: expect.stringContaining(pip.code) });
    expect(liste.find((x) => x.entity_type === 'PROGRAMME').objet).toContain('Programme 71');
    expect((await sev.put(`/programmation/risques/${r.body.id}`, { ...r.body, statut: 'MAITRISE' })).body.statut).toBe('MAITRISE');
    expect((await sev.get(`/programmation/banque/${pip.id}`)).body.jalons).toHaveLength(2);
  });
});
