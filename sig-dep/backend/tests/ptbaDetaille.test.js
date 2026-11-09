'use strict';
/**
 * PTBA en vue budgétaire détaillée (1.35.0) : lecture des feuilles au format DDCN / DCS, rapport
 * d’anomalies, feuilles d’un autre ministère, import avec lignes de dépense, export au même format,
 * intangibilité après validation. Classeur fictif construit pour le test.
 */
const ExcelJS = require('exceljs');
const { db, request, app, login, api } = require('./helpers');
const { analyser, lireMontant } = require('../src/services/ptba');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
const JAUNE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

/** Feuille au format détaillé (en-tête sur deux lignes, hiérarchie, lignes de dépense, totaux). */
function feuilleDetaillee(wb, nom) {
  const ws = wb.addWorksheet(nom);
  ws.getRow(1).values = ['Désignation', null, null, 'Structure destinataire', 'Nature économique (titre et littera)', 'Section/Chapitre', 'Unité physique', 'Chronogramme', ...Array(11).fill(null), 'Coût en FC', null, 'Lieu d\'exécution', 'Mode de gestion'];
  ws.mergeCells('A1:C2'); ws.mergeCells('T1:U1'); ws.mergeCells('H1:S1');
  ws.getRow(2).values = [null, null, null, null, null, null, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 'Coût', 'Source'];
  const ligne = (r, cells) => Object.entries(cells).forEach(([c, v]) => { ws.getCell(`${c}${r}`).value = v; });
  ligne(4, { A: 'MINISTERE DE L’ECONOMIE NUMERIQUE' });
  ligne(5, { A: 'PROGRAMME 3 : Programme d’essai (fictif)' });
  ligne(6, { A: 'Intitulé Ministère ou Service : Direction Cybersécurité (DCS)' });
  ligne(7, { A: 'ACTION 1 : Action d’essai' });
  ligne(8, { A: 'ACTIVITÉ 1 : Activité d’essai' });
  ligne(9, { A: 'Tâche 1.1. : Première tâche', T: { formula: 'T10+T11', result: 300000000 } });
  ligne(10, { A: 'Prime et indemnités', D: 'DCS', E: 'Primes', F: '71209-3', G: '10 pers.', T: 100000000, U: 'GVT', V: 'Kinshasa', W: 'Régie' });
  ligne(11, { A: 'Fournitures', D: 'DCS', E: 'Fournitures', F: '71209-4', T: '200 000 000', U: 'GVT', V: 'Kinshasa', W: 'Marché public' });
  for (const c of ['H', 'I']) ws.getCell(`${c}10`).fill = JAUNE;
  ws.getCell('L11').value = 'X';
  ligne(12, { A: 'Total Tâche', T: '300 000 000 FC' });
  ligne(13, { A: 'Tâche 1.2. : Deuxième tâche', T: { formula: '#REF!+T14', result: { error: '#REF!' } } });
  ligne(14, { A: 'Matériel', D: 'DCS', T: '100 000 00', V: 'Kinshasa' });
  ligne(15, { A: 'Mission', D: 'DCS', T: 1500000.5, V: 'Provinces' });
  ligne(16, { T: 49000000 });
  ligne(17, { A: 'ACTIVITÉ 2 : Activité au montant exceptionnel' });
  ligne(18, { A: 'Tâche 2.1. : Impression' });
  ligne(19, { A: 'Impression des supports', D: 'DCS', T: 100000000000 });
  ligne(20, { A: 'Total Tâche', T: 1 });
  return ws;
}

async function classeur() {
  const wb = new ExcelJS.Workbook();
  feuilleDetaillee(wb, 'DCS');
  // Feuille masquée d’un autre ministère (vue standard)
  const ws = wb.addWorksheet('Feuil9', { state: 'hidden' });
  ws.getCell('A2').value = 'Ministère: Transports (fictif)';
  ws.getCell('A4').value = 'Programme : Programme des transports (fictif)';
  const entete = ['N°', 'Activités principales', 'Tâches', 'Coût', 'Chronogramme', '', '', '', '', '', '', '', '', '', '', '', 'Structures Responsable', 'Résultats attendus', 'Indicateurs de réalisation', 'Source/Moyen de vérification', 'Source de Financement'];
  ws.getRow(6).values = entete;
  ws.getRow(7).values = [...entete.slice(0, 4), 'T1'];
  ws.getRow(8).values = [...entete.slice(0, 4), 'J'];
  ws.getCell('A9').value = 'Objectif spécifique 1: Transport (fictif)';
  ['Office des routes (fictif)', 'Société de transport (fictif)', 'Régie des ports (fictif)'].forEach((s, i) => {
    ws.getRow(10 + i).values = [i + 1, `Activité ${i + 1}`, 'Tâche', 1000000 * (i + 1), ...Array(12).fill(null), s];
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('PTBA — vue budgétaire détaillée et rapport d’anomalies', () => {
  let prg; let cbprg; let cdps; let dir; let exercice;
  beforeAll(async () => {
    prg = api(await login('ag.prg1')); cbprg = api(await login('cb.prg')); cdps = api(await login('cd.ps')); dir = api(await login('directeur'));
    exercice = (await prg.post('/planification/exercices', { annee: 2031 })).body;
  });

  test('montants : groupes irréguliers, centimes, formules en erreur', () => {
    expect(lireMontant('100 000 00')).toMatchObject({ valeur: 10000000, gravite: 'ERREUR', anomalie: expect.stringMatching(/mal saisi/) });
    expect(lireMontant('2 576  000 000')).toEqual({ valeur: 2576000000 });
    expect(lireMontant('850 000 000 FC')).toEqual({ valeur: 850000000 });
    expect(lireMontant(1500000.5)).toMatchObject({ valeur: 1500000.5, gravite: 'ALERTE' });
    expect(lireMontant('37 944 253 376,00')).toEqual({ valeur: 37944253376 });
    expect(lireMontant({ formula: '#REF!+T4', result: { error: '#REF!' } })).toMatchObject({ gravite: 'ERREUR', anomalie: expect.stringMatching(/#REF!/) });
    expect(lireMontant('GVT')).toMatchObject({ gravite: 'ERREUR' });
  });

  test('lecture : hiérarchie, lignes de dépense, anomalies, feuille d’un autre ministère', async () => {
    const services = await db('plan_services').select('sigle', 'libelle');
    const r = await analyser(await classeur(), { services });
    const dcs = r.feuilles.find((f) => f.feuille === 'DCS');
    expect(dcs).toMatchObject({ vue: 'DETAILLEE', programme: 'Programme d’essai (fictif)', service_libelle: 'Direction Cybersécurité (DCS)', autre_ministere: null, nb_lignes: 3, nb_details: 5 });
    const [t1, t2, t3] = dcs.objectifs[0].lignes;
    expect(t1).toMatchObject({ numero: '1.1', activite: 'ACTIVITÉ 1 : Activité d’essai', cout: 300000000, mois: [1, 2, 5], structure_responsable: 'DCS', source_financement: 'GVT' });
    expect(t1.details[0]).toMatchObject({ designation: 'Prime et indemnités', nature_economique: 'Primes', section_chapitre: '71209-3', unite_physique: '10 pers.', mois: [1, 2], cout: 100000000, lieu: 'Kinshasa', mode_gestion: 'Régie' });
    expect(t2.cout).toBe(11500000.5);
    expect(t3.cout).toBe(100000000000);
    const messages = dcs.anomalies.map((a) => `${a.gravite} ${a.message}`).join('\n');
    expect(messages).toMatch(/ERREUR .*#REF!/);
    expect(messages).toMatch(/ERREUR .*mal saisi « 100 000 00 »/);
    expect(messages).toMatch(/ALERTE .*centimes/);
    expect(messages).toMatch(/ERREUR Montant de 49 000 000 CDF sans désignation/);
    expect(messages).toMatch(/ALERTE .*montant exceptionnel/);
    expect(messages).toMatch(/ALERTE Total Tâche : 1 CDF déclarés, 100 000 000 000 CDF calculés/);
    expect(messages).not.toMatch(/Total Tâche : 300/); // total cohérent : pas d’alerte
    const autre = r.feuilles.find((f) => f.feuille === 'Feuil9');
    expect(autre.masquee).toBe(true);
    expect(autre.autre_ministere).toMatch(/Transports \(fictif\).*aucune structure responsable/);
  });

  test('import, contrôle, export au format détaillé et intangibilité', async () => {
    const fichier = await classeur();
    const an = await request(app).post('/api/ptba/import/analyser').set('Authorization', `Bearer ${await login('ag.prg1')}`).attach('fichier', fichier, 'ptba-detaille.xlsx');
    expect(an.status).toBe(200);
    expect(an.body.fichier).toBe('ptba-detaille.xlsx');
    const dcs = an.body.feuilles.find((f) => f.feuille === 'DCS');
    expect(dcs.service_id).toBeTruthy();
    const c = await prg.post('/ptba/import/confirmer', { exercice_id: exercice.id, fichier: an.body.fichier, feuilles: [dcs] });
    expect(c.status).toBe(201);
    const id = c.body.data[0].id;
    const p = (await prg.get(`/ptba/${id}`)).body;
    expect(p).toMatchObject({ vue: 'DETAILLEE' });
    expect(p.rapport_import.anomalies.length).toBe(dcs.anomalies.length);
    expect(p.lignes.map((l) => l.details.length)).toEqual([2, 2, 1]);
    expect(p.lignes.reduce((s, l) => s + l.cout, 0)).toBe(100311500000.5);
    // Modification : le coût d’une tâche suit ses lignes de dépense
    const objectifs = [{ libelle: p.objectifs[0].libelle, lignes: p.lignes.map((l) => ({ activite: l.activite, taches: l.taches, cout: 0, mois: [], details: l.details.map(({ id: _i, ligne_id: _l, ordre: _o, ...d }) => d) })) }];
    objectifs[0].lignes[2].details[0].cout = 2000000;
    for (const l of objectifs[0].lignes) for (const d of l.details) if (!d.mois.length) d.mois = [3]; // chronogramme exigé à la soumission
    expect((await prg.put(`/ptba/${id}`, { programme_id: null, objectif_global: 'Objectif d’essai', objectifs })).status).toBe(200);
    expect((await prg.get(`/ptba/${id}`)).body.lignes[2].cout).toBe(2000000);
    // Export au même format, relu à l’identique
    const x = await binaire(prg.get(`/ptba/${id}/export/xlsx`));
    expect(x.status).toBe(200);
    const relu = await analyser(x.body);
    const f = relu.feuilles[0];
    expect(f.vue).toBe('DETAILLEE');
    expect(f.objectifs[0].lignes.map((l) => [l.taches, l.cout, l.details.length])).toEqual((await prg.get(`/ptba/${id}`)).body.lignes.map((l) => [l.taches, l.cout, l.details.length]));
    expect(f.anomalies.filter((a) => a.gravite !== 'INFO').map((a) => a.message)).toEqual([expect.stringMatching(/^Mission — montant avec centimes/)]);
    expect((await binaire(prg.get(`/ptba/${id}/export/pdf`))).status).toBe(200);
    // Circuit puis intangibilité des lignes de dépense
    for (const [a, u] of [[prg, 'soumettre'], [cbprg, 'verifier'], [cdps, 'consolider']]) expect((await a.post(`/ptba/${id}/${u}`, {})).status).toBe(200);
    expect((await dir.post(`/ptba/${id}/valider`, {})).status).toBe(200);
    await expect(db('ptba_details').where({ ptba_id: id }).update({ cout: 1 })).rejects.toThrow(/PTBA_VERROUILLE/);
    await expect(db('ptba').where({ id }).update({ rapport_import: '{}' })).rejects.toThrow(/PTBA_VERROUILLE/);
  });
});
