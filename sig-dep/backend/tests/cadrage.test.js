'use strict';
/**
 * Lot 11 — Cadrage budgétaire (CBMT) : plafonds du Ministère par année et par rubrique, contrôle
 * des prévisions de crédits, reprise dans le CDMT et le PAP, circuit de validation. Données fictives.
 */
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { app, request, login, api, PDF } = require('./helpers');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
const A = 2041;

describe('Cadrage budgétaire (CBMT)', () => {
  let prg; let cbprg; let cdps; let dir; let str; let programme; let postes; let cbmt;
  beforeAll(async () => {
    prg = api(await login('ag.prg1')); cbprg = api(await login('cb.prg')); cdps = api(await login('cd.ps')); dir = api(await login('directeur')); str = api(await login('ag.str1'));
    programme = (await cbprg.post('/planification/programmes', { code: '81', libelle: 'Programme de cadrage (essai)' })).body;
    postes = (await cbprg.get(`/programmation/credits?annee=${A}`)).body.postes;
  });
  const rub = (c) => postes.find((p) => p.axe === 'RUBRIQUE' && p.code === c).id;

  test('saisie du CBMT : période de trois ans, rubriques connues, programmes et projets existants', async () => {
    expect((await str.post('/programmation/documents', { type: 'CBMT', annee: A })).status).toBe(403);
    cbmt = (await prg.post('/programmation/documents', { type: 'CBMT', annee: A })).body;
    expect(cbmt.type).toBe('CBMT');
    expect((await prg.put(`/programmation/documents/${cbmt.id}`, { contenu: { plafonds: { [A + 3]: { REM: 1 } } } })).status).toBe(400);
    expect((await prg.put(`/programmation/documents/${cbmt.id}`, { contenu: { plafonds: { [A]: { XYZ: 1 } } } })).status).toBe(400);
    expect((await prg.put(`/programmation/documents/${cbmt.id}`, { contenu: { actions: [{ libelle: 'Action inconnue', programme_id: 999999 }] } })).status).toBe(400);
    const ok = await prg.put(`/programmation/documents/${cbmt.id}`, { contenu: {
      source: 'Ministère du Budget (essai)', date_publication: `${A - 1}-05-31`, orientations: 'Inclusion numérique (essai).',
      hypotheses: { [A]: { croissance: 5.4, inflation: 7.1, taux_change: 2900, pib_nominal: 300000 } },
      plafonds: { [A]: { REM: 600, FONC: 250, INV_RP: 150 }, [A + 1]: { REM: 650, FONC: 260, INV_RP: 200 }, [A + 2]: { REM: 700, FONC: 270, INV_RP: 250 } },
      actions: [{ libelle: 'Identité numérique (essai)', programme_id: programme.id, pips: [] }],
    } });
    expect(ok.status).toBe(200);
  });

  test('contrôle des prévisions : écarts et dépassements signalés à la saisie des crédits', async () => {
    const lignes = [
      { annee: A, type: 'PREVISION', programme_id: programme.id, poste_id: rub('REM'), montant: 580 },
      { annee: A, type: 'PREVISION', programme_id: programme.id, poste_id: rub('FONC'), montant: 300 },
      { annee: A + 1, type: 'PREVISION', programme_id: programme.id, poste_id: rub('REM'), montant: 640 },
      // Les crédits par action détaillent ceux du programme : ils n’entrent pas dans le contrôle.
      { annee: A, type: 'PREVISION', programme_id: programme.id, poste_id: rub('FONC'), montant: 9999 },
    ];
    lignes[3].action_id = (await cbprg.post('/planification/actions', { programme_id: programme.id, code: '1', libelle: 'Action de cadrage' })).body.id;
    const r = await cbprg.put('/programmation/credits', { lignes });
    expect(r.status).toBe(200);
    expect(r.body.depassements).toEqual([
      { annee: A, rubrique: 'Fonctionnement des Ministères', plafond: 250, prevision: 300 },
    ]);
    const c = (await str.get(`/programmation/cadrage?annee=${A + 1}`)).body.controle;
    expect(c.cbmt).toMatchObject({ id: cbmt.id, periode: `${A}-${A + 2}`, statut: 'BROUILLON' });
    const y0 = c.annees[0];
    expect(y0.lignes.find((l) => l.code === 'REM')).toMatchObject({ plafond: 600, prevision: 580, ecart: 20, depasse: false });
    expect(y0.lignes.find((l) => l.code === 'FONC')).toMatchObject({ plafond: 250, prevision: 300, ecart: -50, depasse: true });
    expect(y0.total).toMatchObject({ plafond: 1000, prevision: 880, ecart: 120, depasse: false });
    expect((await str.get(`/programmation/cadrage?annee=${A + 3}`)).body.controle).toBeNull();
  });

  test('exports : fiche CBMT, CDMT et PAP reprennent le respect des plafonds', async () => {
    const x = await binaire(str.get(`/programmation/documents/${cbmt.id}/export`));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Cadrage', 'Respect du CBMT', 'Actions prioritaires']);
    expect(wb.getWorksheet('Actions prioritaires').getRow(2).values.slice(1, 3)).toEqual([1, 'Identité numérique (essai)']);
    const cdmt = (await prg.post('/programmation/documents', { type: 'CDMT', annee: A })).body;
    const wc = new ExcelJS.Workbook();
    await wc.xlsx.load((await binaire(str.get(`/programmation/documents/${cdmt.id}/export`))).body);
    expect(wc.worksheets.map((w) => w.name)).toContain('Respect du CBMT');
    const pap = (await prg.post('/programmation/documents', { type: 'PAP', annee: A })).body;
    const docx = (await binaire(str.get(`/programmation/documents/${pap.id}/export`))).body;
    const texte = (await (await JSZip.loadAsync(docx)).file('word/document.xml').async('string')).replace(/<[^>]+>/g, ' ');
    expect(texte).toMatch(/Respect des plafonds du CBMT/);
    expect(texte).toMatch(/Identité numérique \(essai\)/);
  });

  test('pièce jointe pendant la préparation, circuit et intangibilité', async () => {
    const up = await request(app).post(`/api/attachments/PLAN_DOCUMENT/${cbmt.id}`).set('Authorization', `Bearer ${await login('ag.prg1')}`).attach('fichiers', PDF, 'cbmt.pdf');
    expect(up.status).toBe(201);
    expect((await request(app).post(`/api/attachments/PLAN_DOCUMENT/${cbmt.id}`).set('Authorization', `Bearer ${await login('ag.str1')}`).attach('fichiers', PDF, 'x.pdf')).status).toBe(403);
    for (const [u, e] of [[prg, 'soumettre'], [cbprg, 'verifier'], [cdps, 'consolider'], [dir, 'valider']]) expect((await u.post(`/programmation/documents/${cbmt.id}/${e}`)).status).toBe(200);
    expect((await prg.put(`/programmation/documents/${cbmt.id}`, { contenu: {} })).status).toBe(400);
    expect((await str.get(`/programmation/cadrage?annee=${A}`)).body.controle.cbmt.statut).toBe('VALIDE');
  });
});
