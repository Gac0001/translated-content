'use strict';
/**
 * Import du personnel. Les fichiers sont générés dans le test, au format de la liste officielle
 * (tableau Word avec lignes de section), avec des noms FICTIFS.
 */
const { Document, Packer, Table, TableRow, TableCell, Paragraph, TextRun, WidthType } = require('docx');
const ExcelJS = require('exceljs');
const { db, login, api, request, app } = require('./helpers');
const { splitNom, normalizeMatricule } = require('../src/services/importAgents');

const cell = (t, span) => new TableCell({ columnSpan: span, width: { size: 1000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(t)] })] });
const COLS = 6;
function docxListe(lignes) {
  const rows = [new TableRow({ children: ['N°', 'NOM, POSTNOM & PRENOM', 'MATRICULE', 'FONCTION', 'Lundi', 'Mardi'].map((t) => cell(t)) })];
  for (const l of lignes) {
    rows.push(typeof l === 'string'
      ? new TableRow({ children: [cell(l, COLS)] })
      : new TableRow({ children: [cell(l[0]), cell(l[1]), cell(l[2]), cell(l[3]), cell(''), cell('')] }));
  }
  const doc = new Document({ sections: [{ children: [new Paragraph('Semaine du lundi au vendredi'), new Table({ rows })] }] });
  return Packer.toBuffer(doc);
}

const analyser = (token, buffer, name) => request(app).post('/api/imports/personnel/analyser').set('Authorization', `Bearer ${token}`).attach('fichier', buffer, name);

describe('Découpage et normalisation', () => {
  test('nom, postnom, prénom', () => {
    expect(splitNom('KALOMBO MUSAU Jean-Paul')).toEqual({ nom: 'KALOMBO', postnom: 'MUSAU', prenom: 'Jean-Paul' });
    expect(splitNom('BAZOLA NTEMO KIALA Rose Marie')).toEqual({ nom: 'BAZOLA', postnom: 'NTEMO KIALA', prenom: 'Rose Marie' });
    expect(splitNom('KIALA NTEMO')).toEqual({ nom: 'KIALA', postnom: 'NTEMO', prenom: null });
    expect(splitNom('MPIA KISA Élodie joëlle')).toEqual({ nom: 'MPIA', postnom: 'KISA', prenom: 'Élodie joëlle' });
  });
  test('matricule', () => {
    expect(normalizeMatricule('9.900.001')).toBe('9900001');
    expect(normalizeMatricule(' 780 111 ')).toBe('780111');
  });
});

describe('Analyse d’une liste Word', () => {
  let dir;
  beforeAll(async () => { dir = await login('directeur'); });

  test('section précédée du code organique (5.3.3.x)', async () => {
    const buf = await docxListe(['5.3.3.2.2 Coop. Int.', ['1', 'TESTF FICTIF Zeta', '9900011', 'ATA1'], '5.3.3.3 Div. P&S', ['2', 'TESTG FICTIF Eta', '9900012', 'ATA2']]);
    const L = (await analyser(dir, buf, 'liste.docx')).body.lignes;
    expect(L[0].structure).toMatchObject({ type: 'BUREAU', nom: 'Bureau Coopération Internationale' });
    expect(L[1].structure).toMatchObject({ type: 'DIVISION', nom: 'Division Programme et Suivi' });
  });

  test('sections, structures (sans accents), postes proposés et anomalies', async () => {
    const buf = await docxListe([
      '1. Bureau Secrétariat de Direction',
      ['1', 'TESTA FICTIF Alpha', '9.900.001', 'ATA2'],
      '2. Division Etudes, Documentation et Information',
      ['2', 'TESTB FICTIF Beta', '990.002', 'CD'],
      '2.1. Bureau Etudes, Analyses et Perspective',
      ['3', 'TESTC FICTIF Gamma', '9900003', 'ZZ9'],
      ['4', 'TESTD FICTIF Delta', '9900003', 'AGA1'],
      '9. Bureau Inexistant',
      ['5', 'TESTE FICTIF', '9900005', 'AA2'],
    ]);
    const r = await analyser(dir, buf, 'liste.docx');
    expect(r.status).toBe(200);
    expect(r.body.format).toBe('Word');
    const L = r.body.lignes;
    expect(L).toHaveLength(5);
    expect(L[0]).toMatchObject({ nom: 'TESTA', postnom: 'FICTIF', prenom: 'Alpha', matricule: '9900001', role: 'AGENT' });
    expect(L[0].structure.nom).toBe('Bureau Secrétariat de Direction');
    expect(L[1]).toMatchObject({ role: 'CHEF_DIVISION', matricule: '990002' });
    expect(L[1].structure).toMatchObject({ type: 'DIVISION', nom: 'Division Études, Documentation et Information' });
    expect(L[1].anomalies.map((a) => a.message).join(' ')).toMatch(/déjà un responsable/); // Chef de Division de démonstration en poste
    expect(L[2].structure.nom).toBe('Bureau Études, Analyses et Prospective'); // « Perspective » de la liste reconnu
    expect(L[2].anomalies.some((a) => /Grade « ZZ9 » inconnu/.test(a.message))).toBe(true);
    expect(L[3].anomalies.some((a) => a.niveau === 'erreur' && /plusieurs fois/.test(a.message))).toBe(true);
    expect(L[4].structure).toBeNull();
    expect(L[4].prenom).toBeNull();
    expect(r.body.resume).toMatchObject({ total: 5, erreurs: 2, sansStructure: 1 });
    expect(await db('agents').where('matricule', 'like', '99000%')).toHaveLength(0); // aucune écriture
  });

  test('fichier sans en-tête reconnu ou format refusé', async () => {
    const buf = await docxListe(['Section seule']);
    const bad = await request(app).post('/api/imports/personnel/analyser').set('Authorization', `Bearer ${dir}`).attach('fichier', Buffer.from('x'), 'liste.pdf');
    expect(bad.status).toBe(400);
    expect((await analyser(dir, Buffer.from('a;b\n1;2'), 'x.csv')).body.error.message).toMatch(/En-tête introuvable/);
    expect((await analyser(dir, buf, 'l.docx')).body.lignes).toHaveLength(0);
  });

  test('un Agent ne peut pas importer', async () => {
    const buf = await docxListe([]);
    expect((await analyser(await login('ag.eap1'), buf, 'l.docx')).status).toBe(403);
  });
});

describe('Analyse d’un fichier Excel à colonnes séparées', () => {
  test('colonnes Nom / Postnom / Prénom / Sexe / Structure', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Personnel');
    ws.addRow(['Matricule', 'Nom', 'Postnom', 'Prénom', 'Sexe', 'Grade', 'Structure', 'E-mail']);
    ws.addRow(['9.900.101', 'TESTF', 'FICTIF', 'Zeta', 'F', 'ATA1', 'Bureau Stratégies', 'zeta@exemple.cd']);
    const r = await analyser(await login('directeur'), Buffer.from(await wb.xlsx.writeBuffer()), 'liste.xlsx');
    expect(r.body.lignes[0]).toMatchObject({ nom: 'TESTF', postnom: 'FICTIF', prenom: 'Zeta', sexe: 'F', email: 'zeta@exemple.cd', matricule: '9900101', role: 'AGENT' });
    expect(r.body.lignes[0].structure.nom).toBe('Bureau Stratégies');
  });
});

describe('Exécution de l’import', () => {
  let dir; let bsd; let str; let neuf;
  beforeAll(async () => {
    dir = api(await login('directeur'));
    bsd = await db('bureaux').where({ code: 'BSD' }).first();
    str = await db('bureaux').where({ code: 'BUR-STR' }).first();
    neuf = (await dir.post('/organisation/bureaux', { code: 'BUR-IMP', nom: 'Bureau Import', rattachement: 'DIRECTION' })).body;
  });

  test('tout ou rien : une ligne invalide bloque l’ensemble', async () => {
    const r = await dir.post('/imports/personnel/executer', { date_affectation: '2026-03-23', lignes: [
      { matricule: '9900201', nom: 'TESTG', structure_type: 'BUREAU', structure_id: bsd.id, role: 'AGENT' },
      { matricule: '9.900.201', nom: 'TESTH', structure_type: 'BUREAU', structure_id: bsd.id, role: 'AGENT' },
      { matricule: '9900202', nom: 'TESTI', structure_type: 'BUREAU', structure_id: bsd.id, role: 'CHEF_BUREAU' },
    ] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('IMPORT_INVALIDE');
    expect(r.body.error.details.map((d) => d.message).join(' ')).toMatch(/double/);
    expect(r.body.error.details.map((d) => d.message).join(' ')).toMatch(/déjà un responsable/);
    expect(await db('agents').whereIn('matricule', ['9900201', '9900202'])).toHaveLength(0);
  });

  test('création des Agents, du Chef de Bureau et des affectations', async () => {
    const grade = await db('grades').where({ code: 'CB' }).first();
    const r = await dir.post('/imports/personnel/executer', { fichier: 'liste.docx', date_affectation: '2026-03-23', lignes: [
      { matricule: '9.900.301', nom: 'testj', postnom: 'fictif', prenom: 'Eta', grade_id: grade.id, structure_type: 'BUREAU', structure_id: neuf.id, role: 'CHEF_BUREAU' },
      { matricule: '9900302', nom: 'TESTK', structure_type: 'BUREAU', structure_id: neuf.id, role: 'AGENT' },
      { matricule: '9900303', nom: 'TESTL' },
    ] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ crees: 3, affectations: 2, sansAffectation: 1 });
    const j = await db('agents').where({ matricule: '9900301' }).first();
    expect(j).toMatchObject({ nom: 'TESTJ', postnom: 'FICTIF', prenom: 'Eta', sexe: null });
    const aff = await db('affectations as a').join('postes_organiques as p', 'p.id', 'a.poste_id').where({ 'a.agent_id': j.id, 'a.est_active': true }).first('p.role_associe', 'a.bureau_id', 'a.date_debut');
    expect(aff).toMatchObject({ role_associe: 'CHEF_BUREAU', bureau_id: neuf.id, date_debut: '2026-03-23' });
    const o = await dir.get('/organisation/organigramme');
    expect(o.body.bureauxRattachesDirection.find((b) => b.code === 'BUR-IMP').responsable.nomComplet).toContain('TESTJ');
    expect(await db('audit_logs').where({ action: 'IMPORT', module: 'personnel' }).first()).toBeTruthy();
  });

  test('matricule existant : ignoré par défaut, ou mis à jour et réaffecté', async () => {
    const ignore = await dir.post('/imports/personnel/executer', { date_affectation: '2026-03-23', lignes: [{ matricule: '9900302', nom: 'TESTK', prenom: 'Theta' }] });
    expect(ignore.body).toMatchObject({ crees: 0, ignores: 1 });
    const maj = await dir.post('/imports/personnel/executer', { date_affectation: '2026-04-01', mode_existants: 'mettre_a_jour', lignes: [{ matricule: '9900302', nom: 'TESTK', prenom: 'Theta', structure_type: 'BUREAU', structure_id: str.id, role: 'AGENT' }] });
    expect(maj.body).toMatchObject({ misAJour: 1, affectations: 1 });
    const k = await db('agents').where({ matricule: '9900302' }).first();
    expect(k.prenom).toBe('Theta');
    const hist = await db('affectations').where({ agent_id: k.id }).orderBy('id');
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ est_active: false, date_fin: '2026-04-01' });
    expect(hist[1]).toMatchObject({ est_active: true, bureau_id: str.id });
  });

  test('le Bureau Secrétariat (désignation) importe les fiches sans pouvoir affecter', async () => {
    const cbs = api(await login('cb.secretariat'));
    const r = await cbs.post('/imports/personnel/executer', { date_affectation: '2026-03-23', lignes: [{ matricule: '9900401', nom: 'TESTM', structure_type: 'BUREAU', structure_id: str.id, role: 'AGENT' }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ crees: 1, affectations: 0, sansAffectation: 1 });
    expect(r.body.details[0].resultat).toMatch(/droit d’affectation requis/);
  });

  test('modèle Excel téléchargeable', async () => {
    const r = await dir.get('/imports/personnel/modele.xlsx');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
  });
});
