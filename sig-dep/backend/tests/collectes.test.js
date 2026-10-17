'use strict';
/**
 * Lot F (1.44.0) — Collecte auprès des services du Secrétariat Général : campagnes, modèles Excel
 * pré-remplis et protégés, import contrôlé avec rapport d’anomalies, statuts par service, intégration
 * (PTBA, cadre de performance, dépenses d’investissement), retards. Données fictives (exercice 2081).
 */
const ExcelJS = require('exceljs');
const { db, request, app, login, api } = require('./helpers');

const A = 2081;
const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });

async function charger(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const meta = {};
  wb.getWorksheet('_sigdep').eachRow((r) => { meta[r.getCell(1).value] = r.getCell(2).value; });
  return { wb, ws: wb.getWorksheet('Saisie'), meta, entete: Number(meta.ligne_entete) };
}
const tampon = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());

describe('Collecte auprès des services du Secrétariat Général', () => {
  let prg; let cbprg; let cdps; let sev; let tPrg; let s1; let s2; let programme; let action; let campagne;
  const importer = (cid, sid, buf, nom = 'retour.xlsx') => request(app).post(`/api/collectes/${cid}/services/${sid}/import`).set('Authorization', `Bearer ${tPrg}`)
    .attach('fichier', buf, { filename: nom, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const modele = async (cid, sid) => charger((await binaire(prg.get(`/collectes/${cid}/services/${sid}/modele`))).body);

  beforeAll(async () => {
    tPrg = await login('ag.prg1');
    prg = api(tPrg); cbprg = api(await login('cb.prg')); cdps = api(await login('cd.ps')); sev = api(await login('ag.sev1'));
    await cbprg.post('/planification/exercices', { annee: A, statut: 'PREPARATION' });
    programme = (await cbprg.post('/planification/programmes', { code: 'C81', libelle: 'Programme de collecte (essai)', objectif_global: 'Essai' })).body;
    action = (await cbprg.post('/planification/actions', { programme_id: programme.id, code: '1', libelle: 'Action collectée (essai)' })).body;
    [s1, s2] = await db('plan_services').where({ actif: true }).orderBy('id').limit(2);
    await db('plan_services').whereIn('id', [s1.id, s2.id]).update({ programme_id: programme.id });
  });

  test('campagne PTBA : préparation par le Bureau Programme, ouverture par le Chef de la Division Programme et Suivi', async () => {
    const corps = { objet: 'PTBA', annee: A, titre: `Collecte des PTBA ${A} (essai)`, echeance: '2099-12-31', instructions: 'Instructions fictives.', services: [s1.id, s2.id] };
    expect((await sev.post('/collectes', corps)).status).toBe(403);
    expect((await prg.post('/collectes', { ...corps, objet: 'PLAN_ACTIONS' })).status).toBe(400);
    const r = await prg.post('/collectes', corps);
    expect(r.status).toBe(201);
    campagne = r.body;
    expect(campagne.reference).toMatch(/^DEP\/COL\/\d{4}\/\d{4}$/);
    expect((await prg.post(`/collectes/${campagne.id}/ouvrir`)).status).toBe(403);
    expect((await cdps.post(`/collectes/${campagne.id}/ouvrir`)).body.statut).toBe('OUVERTE');
    const d = (await prg.get(`/collectes/${campagne.id}`)).body;
    expect(d.services.map((s) => s.statut)).toEqual(['ATTENDU', 'ATTENDU']);
    expect(d.droits).toMatchObject({ importer: true, decider: false, cloturer: false });
    expect((await cdps.get(`/collectes/${campagne.id}`)).body.droits.cloturer).toBe(true);
    const u = await db('users').where({ username: 'ag.prg2' }).first();
    expect(await db('notifications').where({ user_id: u.id, type: 'COLLECTE' }).first()).toBeDefined();
    expect((await api(await login('sg')).get(`/collectes/${campagne.id}`)).status).toBe(403);
  });

  test('modèle : pré-rempli, protégé, listes déroulantes, identification cachée', async () => {
    const d = (await prg.get(`/collectes/${campagne.id}`)).body;
    const { wb, ws, meta, entete } = await modele(campagne.id, d.services[0].id);
    expect(meta).toMatchObject({ campagne: campagne.reference, service: s1.sigle, objet: 'PTBA' });
    expect(wb.getWorksheet('_sigdep').state).toBe('veryHidden');
    expect(ws.sheetProtection).toMatchObject({ sheet: true });
    expect(ws.getRow(entete).getCell(3).value).toBe('Activité *');
    const premiere = ws.getRow(entete + 1);
    expect(premiere.getCell(2).protection).toMatchObject({ locked: false });
    expect(premiere.getCell(5).dataValidation).toMatchObject({ type: 'list' });
    const listes = wb.getWorksheet('Listes');
    const actions = []; listes.getColumn(1).eachCell((c) => actions.push(c.value));
    expect(actions).toContain(`1 — Action collectée (essai)`);
    let texte = ''; ws.eachRow((r) => r.eachCell((c) => { texte += ` ${c.value}`; }));
    expect(texte).toMatch(new RegExp(`Service : ${s1.sigle}`));
    expect(texte).toMatch(/Programme C81/);
  });

  test('import contrôlé : identification, totaux, codes, versions ; rejet et correction ; intégration en PTBA brouillon', async () => {
    const d = (await prg.get(`/collectes/${campagne.id}`)).body;
    const [c1, c2] = d.services;
    // Fichier qui n’est pas un modèle
    const autre = new ExcelJS.Workbook(); autre.addWorksheet('X').getCell('A1').value = 'x';
    let r = await importer(campagne.id, c1.id, await tampon(autre));
    expect(r.status).toBe(201);
    expect(r.body.anomalies[0].message).toMatch(/n’est pas un modèle de collecte/);
    // Modèle d’un autre service
    const m2 = await modele(campagne.id, c2.id);
    r = await importer(campagne.id, c1.id, await tampon(m2.wb));
    expect(r.body.anomalies.map((a) => a.message).join(' ')).toMatch(/autre service/);
    // Modèle rempli : total déclaré faux, action inconnue
    const m = await modele(campagne.id, c1.id);
    const ligne = (n, vals) => { const row = m.ws.getRow(m.entete + n); vals.forEach((v, i) => { if (v !== undefined) row.getCell(i + 1).value = v; }); };
    ligne(1, [1, 'Objectif A (essai)', 'Activité 1 (essai)', 'Tâche 1', '1 — Action collectée (essai)', 3000000, 'x', 'x']);
    ligne(2, [2, 'Objectif A (essai)', 'Activité 2 (essai)', null, '9 — Inconnue', 2000000, null, null, 'x']);
    ligne(3, [3, 'Objectif B (essai)', 'Activité 3 (essai)', null, null, 1000000]);
    m.ws.getCell(m.meta.cellule_total).value = 5000000;
    r = await importer(campagne.id, c1.id, await tampon(m.wb), 'ptba-service.xlsx');
    expect(r.body).toMatchObject({ lignes: 3, statut: 'RECU' });
    const msgs = r.body.anomalies.map((a) => `${a.gravite} ${a.message}`).join(' | ');
    expect(msgs).toMatch(/ERREUR Action budgétaire inconnue « 9 — Inconnue »/);
    expect(msgs).toMatch(/ERREUR Total déclaré \(5.000.000 CDF\) différent de la somme des lignes \(6.000.000 CDF\)/);
    expect(msgs).toMatch(/ALERTE Activité « Activité 3 \(essai\) » sans chronogramme/);
    // Intégration refusée (erreurs), réservée au Chef du Bureau Programme
    expect((await prg.post(`/collectes/${campagne.id}/services/${c1.id}/integrer`)).status).toBe(403);
    expect((await cbprg.post(`/collectes/${campagne.id}/services/${c1.id}/integrer`)).status).toBe(400);
    // Rejet motivé, puis version corrigée
    expect((await cbprg.post(`/collectes/${campagne.id}/services/${c1.id}/rejeter`, { motif: 'Corriger le total et l’action (essai).' })).body.statut).toBe('REJETE');
    ligne(2, [undefined, undefined, undefined, undefined, '1 — Action collectée (essai)']);
    m.ws.getCell(m.meta.cellule_total).value = 6000000;
    r = await importer(campagne.id, c1.id, await tampon(m.wb), 'ptba-service-corrige.xlsx');
    expect(r.body).toMatchObject({ statut: 'CORRIGE', erreurs: 0, alertes: 1, version: 4 });
    const fiche = (await prg.get(`/collectes/${campagne.id}`)).body.services.find((s) => s.id === c1.id);
    expect(fiche.receptions.map((x) => x.version)).toEqual([4, 3, 2, 1]);
    // Fichier d’origine conservé, téléchargeable
    const f = await binaire(prg.get(`/attachments/fichier/${fiche.derniere.attachment_id}`));
    expect(f.status).toBe(200);
    expect(f.headers['content-disposition']).toMatch(/ptba-service-corrige\.xlsx/);
    expect((await cbprg.get('/dashboard/a-traiter')).body.files.find((x) => x.cle === 'collectes_integrer').items.map((x) => x.to)).toContain(`/collectes/${campagne.id}`);
    // Intégration : PTBA brouillon du service, avec ses activités et le chronogramme
    r = await cbprg.post(`/collectes/${campagne.id}/services/${c1.id}/integrer`);
    expect(r.status).toBe(200);
    expect(r.body.integration.message).toMatch(/PTBA DEP\/PTBA\/.* \(brouillon\) : 3 activité\(s\)/);
    const p = await db('ptba').where({ id: r.body.integration.ptba_id }).first();
    expect(p).toMatchObject({ statut: 'BROUILLON', service_id: s1.id, programme_id: programme.id });
    const lignes = await db('ptba_lignes').where({ ptba_id: p.id }).orderBy('ordre');
    expect(lignes.map((l) => [l.activite, Number(l.cout), l.action_id])).toEqual([['Activité 1 (essai)', 3000000, action.id], ['Activité 2 (essai)', 2000000, action.id], ['Activité 3 (essai)', 1000000, null]]);
    expect(lignes[0].mois).toEqual([1, 2]);
    expect((await db('ptba_objectifs').where({ ptba_id: p.id })).map((o) => o.libelle)).toEqual(['Objectif A (essai)', 'Objectif B (essai)']);
    expect((await importer(campagne.id, c1.id, await tampon(m.wb))).status).toBe(409);
    await expect(db('collecte_receptions').where({ collecte_service_id: c1.id }).del()).rejects.toThrow(/APPEND_ONLY/);
    // Consolidation et historique
    const cons = (await prg.get(`/collectes/${campagne.id}/consolidation`)).body;
    expect(cons.lignes.filter((l) => l.service === s1.sigle)).toHaveLength(3);
    const h = (await prg.get(`/collectes/${campagne.id}`)).body.historique.map((x) => x.action);
    expect(h).toEqual(expect.arrayContaining(['CREATION', 'OUVERTURE', 'RETOUR_SERVICE', 'REJET', 'INTEGRATION']));
  });

  test('retards à l’échéance ; clôture', async () => {
    await db('collectes').where({ id: campagne.id }).update({ echeance: '2020-01-01' });
    const { marquerRetards } = require('../src/modules/collectes/routes');
    expect(await marquerRetards()).toBeGreaterThanOrEqual(1);
    const d = (await prg.get(`/collectes/${campagne.id}`)).body;
    expect(d.services.find((s) => s.service_id === s2.id).statut).toBe('EN_RETARD');
    expect(d.resume).toMatchObject({ total: 2, integres: 1, en_retard: 1 });
    expect((await prg.get('/dashboard/a-traiter')).body.files.find((x) => x.cle === 'collectes_retard').items[0]).toMatchObject({ titre: expect.stringContaining(s2.sigle), alerte: true });
    expect((await prg.get('/dashboard/compteurs')).body.collectes).toBeGreaterThan(0);
    expect((await cdps.post(`/collectes/${campagne.id}/cloturer`)).body.statut).toBe('CLOTUREE');
    expect((await importer(campagne.id, d.services[1].id, Buffer.from('x'))).status).toBe(403);
  });

  test('cadre de performance : indicateurs du programme pré-remplis, réalisations et cibles intégrées', async () => {
    const o = (await cbprg.post('/programmation/objectifs', { programme_id: programme.id, libelle: 'Objectif de performance (essai)' })).body;
    const i = (await cbprg.post('/programmation/indicateurs', { objectif_id: o.id, libelle: 'Taux de couverture (essai)', unite: '%' })).body;
    expect((await cbprg.put(`/programmation/indicateurs/${i.id}/valeurs`, { annee: A - 1, type: 'REALISATION', valeur: 40 })).status).toBe(200);
    const c = (await prg.post('/collectes', { objet: 'CADRE_PERFORMANCE', annee: A, titre: 'Cadre de performance (essai)', echeance: '2099-12-31', services: [s1.id] })).body;
    await cdps.post(`/collectes/${c.id}/ouvrir`);
    const sid = (await prg.get(`/collectes/${c.id}`)).body.services[0].id;
    const m = await modele(c.id, sid);
    const row = m.ws.getRow(m.entete + 1);
    expect(row.getCell(1).value).toBe(i.id);
    expect(row.getCell(5).value).toBe(40);
    expect(row.getCell(5).protection?.locked).not.toBe(false);
    row.getCell(6).value = 55; row.getCell(7).value = 60; row.getCell(9).value = 75;
    const r = await importer(c.id, sid, await tampon(m.wb));
    expect(r.body).toMatchObject({ erreurs: 0, lignes: 1 });
    const ok = await cbprg.post(`/collectes/${c.id}/services/${sid}/integrer`);
    expect(ok.body.integration.valeurs).toBe(3);
    const v = await db('plan_indicateur_valeurs').where({ indicateur_id: i.id }).orderBy(['annee', 'type']);
    expect(v.map((x) => [x.annee, x.type, Number(x.valeur)])).toEqual([[A - 1, 'REALISATION', 40], [A, 'REALISATION', 55], [A + 1, 'CIBLE', 60], [A + 3, 'CIBLE', 75]]);
  });

  test('dépenses d’investissement : projets créés ou mis à jour dans la banque de projets ; contrôles', async () => {
    const pip = await db('pip_projects').whereNot('statut', 'ARCHIVE').first() || (await prg.post('/pip', { donnees: { identification: { libelle: 'Projet existant (essai)' } } })).body;
    const c = (await prg.post('/collectes', { objet: 'INVESTISSEMENT', annee: A, titre: 'Dépenses d’investissement (essai)', echeance: '2099-12-31', services: [s2.id] })).body;
    await cdps.post(`/collectes/${c.id}/ouvrir`);
    const sid = (await prg.get(`/collectes/${c.id}`)).body.services[0].id;
    const m = await modele(c.id, sid);
    const ligne = (n, vals) => { const row = m.ws.getRow(m.entete + n); vals.forEach((v, k) => { row.getCell(k + 1).value = v; }); };
    ligne(1, [1, 'Centre de données provincial (essai)', null, 'Equipements', 'Kasaï (fictif)', 'En étude', 'Oui', 100000000, 200000000, 0, null, 'Etat', 'Projet fictif']);
    ligne(2, [2, 'Projet existant (essai)', pip.code, 'Etudes', null, 'Prêt', null, 5000000, null, null, null, 'Partenaires']);
    ligne(3, [3, 'Centre de données provincial (essai)', null, 'Inconnue', null, null, null, -1, null, null, null, 'Etat']);
    m.ws.getCell(m.meta.cellule_total).value = 305000000;
    let r = await importer(c.id, sid, await tampon(m.wb));
    const msgs = r.body.anomalies.map((a) => a.message).join(' | ');
    expect(msgs).toMatch(/Nature des coûts non prévue « Inconnue »/);
    expect(msgs).toMatch(/Valeur négative/);
    expect(msgs).toMatch(/Doublon des lignes \d+ et \d+/);
    ligne(3, [null, null, null, null, null, null, null, null, null, null, null, null]);
    r = await importer(c.id, sid, await tampon(m.wb));
    expect(r.body).toMatchObject({ erreurs: 0, lignes: 2, total: 305000000 });
    const ok = await cbprg.post(`/collectes/${c.id}/services/${sid}/integrer`);
    expect(ok.body.integration).toMatchObject({ mis_a_jour: [pip.code] });
    const cree = await db('pip_projects').where({ code: ok.body.integration.crees[0] }).first();
    expect(cree).toMatchObject({ statut: 'BROUILLON', maturite: 'ETUDE', programme_id: programme.id, localisation: 'Kasaï (fictif)', devise: 'CDF' });
    expect(Number(cree.cout_total)).toBe(300000000);
    expect(cree.donnees.financier.financement.find((x) => x.source === 'Etat')).toMatchObject({ annee1: 100000000, annee2: 200000000 });
    expect((await db('pip_projects').where({ id: pip.id }).first()).maturite).toBe('PRET');
  });
});
