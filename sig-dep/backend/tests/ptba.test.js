'use strict';
/**
 * Lot 9A — Planification : référentiel, PTBA au format du Ministère (import, circuit, export),
 * suivi trimestriel de l’exécution. Classeur fictif construit pour le test.
 */
const ExcelJS = require('exceljs');
const { db, request, app, login, api, userId } = require('./helpers');
const { analyser, montant, coutParTrimestre } = require('../src/services/ptba');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });

/** Classeur au format du Ministère : titres, trois lignes d’en-tête, objectifs, chronogramme surligné. */
async function classeurFictif() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PTAB TST');
  ws.getCell('A1').value = 'Plan de Travail Annuel Budgétisé';
  ws.getCell('A2').value = 'Ministère: ÉCONOMIE NUMÉRIQUE';
  ws.getCell('A4').value = 'Programme : Programme d’essai';
  ws.getCell('A5').value = 'Objectif global: Tester l’import des PTBA';
  const entete = ['N°', 'Activités principales', 'Tâches', 'Coût', 'Chronogramme', '', '', '', '', '', '', '', '', '', '', '', 'Structures Responsable', 'Résultats attendus', 'Indicateurs de réalisation', 'Source/Moyen de vérification', 'Source de Financement'];
  ws.getRow(6).values = entete;
  ws.getRow(7).values = [...entete.slice(0, 4), 'T1', '', '', 'T2', '', '', 'T3', '', '', 'T4', '', '', ...entete.slice(16)];
  ws.getRow(8).values = [...entete.slice(0, 4), 'J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D', ...entete.slice(16)];
  ws.getCell('A9').value = 'Objectif spécifique 1: Produire les études de base';
  ws.getRow(10).values = [1, 'Étude de référence', 'Rédaction des TDR ; collecte', '15 000 000,00', ...Array(12).fill(null), 'TST', 'Étude validée', 'Nombre d’études', 'Rapport', 'Trésor Public'];
  ws.getRow(11).values = [2, 'Atelier de validation', 'Organisation', 5000000, ...Array(12).fill(null), 'TST', 'Atelier tenu', 'Nombre de participants', 'Liste de présence', 'Trésor Public'];
  for (const c of [5, 6, 7]) ws.getRow(10).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  ws.getRow(11).getCell(13).value = 'x';
  ws.getRow(12).values = [null, 'S/TOTAL', null, 20000000];
  ws.getCell('A13').value = 'Objectif spécifique 2: Suivre la mise en œuvre';
  ws.getRow(14).values = [3, 'Mission de suivi', 'Visites', 8000000, ...Array(12).fill(null), 'TST', 'Missions réalisées', 'Nombre de missions', 'Rapport de mission', 'Partenaires'];
  for (const c of [11, 12, 13, 14]) ws.getRow(14).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  ws.getRow(15).values = [null, 'TOTAL GÉNÉRAL', null, 28000000];
  ws.getRow(16).values = [9, 'Ligne après le total, ignorée', null, 1];
  wb.addWorksheet('Autre').getCell('A1').value = 'Feuille sans format PTBA';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Planification : PTBA', () => {
  let prg; let cbprg; let cdps; let dir; let sev; let exercice; let id;
  beforeAll(async () => {
    prg = api(await login('ag.prg1')); cbprg = api(await login('cb.prg')); cdps = api(await login('cd.ps'));
    dir = api(await login('directeur')); sev = api(await login('ag.sev1'));
  });

  test('outils : montants et coût par trimestre', () => {
    expect(montant('37 944 253 376,00')).toBe(37944253376);
    expect(montant(15000000)).toBe(15000000);
    expect(montant('—')).toBe(0);
    expect(coutParTrimestre([{ cout: 1200, mois: [1, 4] }, { cout: 400, mois: [] }])).toEqual([700, 700, 100, 100]);
  });

  test('référentiel : exercice, programme, action, service (Bureau Programme)', async () => {
    expect((await api(await login('ag.str1')).post('/planification/exercices', { annee: 2027 })).status).toBe(403);
    const e = await prg.post('/planification/exercices', { annee: 2027 });
    expect(e.status).toBe(201);
    exercice = e.body;
    expect((await prg.post('/planification/exercices', { annee: 2027 })).status).toBe(409);
    const p = await prg.post('/planification/programmes', { code: '99', libelle: 'Programme d’essai', objectif_global: 'Tester' });
    expect((await prg.post('/planification/actions', { programme_id: p.body.id, code: '1', libelle: 'Action d’essai' })).status).toBe(201);
    expect((await prg.post('/planification/services', { sigle: 'tst', libelle: 'Service de test' })).body.sigle).toBe('TST');
    const ref = (await api(await login('ag.str1')).get('/planification/referentiel')).body;
    expect(ref.programmes.find((x) => x.code === '99').actions).toHaveLength(1);
    expect(ref.droits.gerer).toBe(false);
  });

  test('import au format du Ministère : analyse puis confirmation', async () => {
    const fichier = await classeurFictif();
    const a = await analyser(fichier);
    expect(a.ignorees).toEqual(['Autre']);
    const f = a.feuilles[0];
    expect(f).toMatchObject({ sigle: 'TST', programme: 'Programme d’essai', objectif_global: 'Tester l’import des PTBA', nb_lignes: 3, cout_total: 28000000 });
    expect(f.objectifs.map((o) => o.lignes.length)).toEqual([2, 1]);
    expect(f.objectifs[0].lignes[0].mois).toEqual([1, 2, 3]);
    expect(f.objectifs[0].lignes[1].mois).toEqual([9]);
    expect(f.objectifs[1].lignes[0]).toMatchObject({ mois: [7, 8, 9, 10], source_financement: 'Partenaires' });
    // Par l’API : réservé au Bureau Programme
    const tok = await login('ag.prg1');
    expect((await request(app).post('/api/ptba/import/analyser').set('Authorization', `Bearer ${await login('ag.str1')}`).attach('fichier', fichier, 'ptba.xlsx')).status).toBe(403);
    const an = await request(app).post('/api/ptba/import/analyser').set('Authorization', `Bearer ${tok}`).attach('fichier', fichier, 'ptba.xlsx');
    expect(an.status).toBe(200);
    expect(an.body.feuilles[0]).toMatchObject({ service_id: expect.any(Number), programme_id: expect.any(Number) });
    const c = await prg.post('/ptba/import/confirmer', { exercice_id: exercice.id, feuilles: an.body.feuilles });
    expect(c.status).toBe(201);
    id = c.body.data[0].id;
    expect((await prg.post('/ptba/import/confirmer', { exercice_id: exercice.id, feuilles: an.body.feuilles })).status).toBe(409);
    const d = (await prg.get(`/ptba/${id}`)).body;
    expect(d).toMatchObject({ statut: 'BROUILLON', service_sigle: 'TST', programme_libelle: 'Programme d’essai' });
    expect(d.objectifs).toHaveLength(2);
    expect(d.trimestres).toEqual([15000000, 0, 11000000, 2000000]);
  });

  test('circuit : soumission, vérification, consolidation, retour, validation, verrou', async () => {
    const d = (await prg.get(`/ptba/${id}`)).body;
    // Modification par le Bureau Programme
    const objectifs = d.objectifs.map((o) => ({ libelle: o.libelle, lignes: d.lignes.filter((l) => l.objectif_id === o.id) }));
    objectifs[1].lignes.push({ activite: 'Rapport annuel', cout: 2000000, mois: [12], structure_responsable: 'TST' });
    const m = await prg.put(`/ptba/${id}`, { programme_id: d.programme_id, objectif_global: d.objectif_global, objectifs });
    expect(m.body.lignes).toHaveLength(4);
    expect((await cbprg.post(`/ptba/${id}/verifier`, {})).status).toBe(400);
    expect((await prg.post(`/ptba/${id}/soumettre`)).body.statut).toBe('SOUMIS');
    expect(await db('notifications').where({ user_id: await userId('cb.prg'), type: 'PTBA' }).first()).toBeTruthy();
    expect((await prg.post(`/ptba/${id}/verifier`, {})).status).toBe(403);
    expect((await cbprg.post(`/ptba/${id}/verifier`, {})).body.statut).toBe('VERIFIE');
    expect((await cdps.post(`/ptba/${id}/retourner`, { motif: 'Préciser les indicateurs' })).body.statut).toBe('A_CORRIGER');
    await prg.post(`/ptba/${id}/soumettre`);
    await cbprg.post(`/ptba/${id}/verifier`, {});
    expect((await api(await login('cd.edi')).post(`/ptba/${id}/consolider`, {})).status).toBe(403);
    expect((await cdps.post(`/ptba/${id}/consolider`, {})).body.statut).toBe('CONSOLIDE');
    // Le SG ne voit que les PTBA validés
    const sg = api(await login('sg'));
    expect((await sg.get(`/ptba/${id}`)).status).toBe(403);
    expect((await dir.post(`/ptba/${id}/valider`, {})).body.statut).toBe('VALIDE');
    expect((await sg.get(`/ptba/${id}`)).status).toBe(200);
    await expect(db('ptba_lignes').where({ ptba_id: id }).update({ cout: 1 })).rejects.toThrow(/PTBA_VERROUILLE/);
    await expect(db('ptba').where({ id }).update({ objectif_global: 'Autre' })).rejects.toThrow(/PTBA_VERROUILLE/);
    expect((await prg.put(`/ptba/${id}`, { objectifs: [] })).status).toBe(400);
  });

  test('suivi trimestriel par le Bureau Suivi-Évaluation, tableau de bord, exports', async () => {
    const d = (await sev.get(`/ptba/${id}`)).body;
    expect(d.actions.suivre).toBe(true);
    const l = d.lignes[0];
    expect((await prg.put(`/ptba/lignes/${l.id}/suivi/1`, { taux_physique: 50, montant_engage: 1, montant_decaisse: 1 })).status).toBe(403);
    expect((await sev.put(`/ptba/lignes/${l.id}/suivi/1`, { taux_physique: 50, montant_engage: 1000, montant_decaisse: 2000 })).status).toBe(400);
    const s = await sev.put(`/ptba/lignes/${l.id}/suivi/1`, { taux_physique: 60, montant_engage: 9000000, montant_decaisse: 6000000, commentaire: 'TDR validés' });
    expect(s.body).toMatchObject({ trimestre: 1, taux_physique: 60 });
    await sev.put(`/ptba/lignes/${l.id}/suivi/1`, { taux_physique: 70, montant_engage: 9000000, montant_decaisse: 7500000 });
    expect(await db('ptba_suivi').where({ ligne_id: l.id })).toHaveLength(1);
    const tb = (await dir.get('/ptba/tableau-de-bord?exercice=2027')).body;
    expect(tb.global).toMatchObject({ cout: 30000000, decaisse: 7500000, tauxFinancier: 25 });
    expect(tb.services[0].sigle).toBe('TST');
    const x = await binaire(dir.get(`/ptba/${id}/export/xlsx`));
    expect(x.status).toBe(200);
    const relu = await analyser(x.body);
    expect(relu.feuilles[0]).toMatchObject({ nb_lignes: 4, cout_total: 30000000 });
    expect(relu.feuilles[0].objectifs[0].lignes[0].mois).toEqual([1, 2, 3]);
    expect((await dir.get(`/ptba/${id}/export/pdf`)).status).toBe(200);
    const cons = await binaire(dir.get('/ptba/export/consolide?exercice=2027'));
    expect(cons.status).toBe(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(cons.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Synthèse', 'PTBA TST']);
  });
});
