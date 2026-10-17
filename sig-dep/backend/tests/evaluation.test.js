'use strict';
/**
 * Lot E (1.42.0) — Évaluation des politiques sectorielles et budgétaires : dossier de l’exercice,
 * annexes I à V reprises du SIG-DEP, saisie, contrôles des taux et totaux, actualisation.
 * Données fictives construites pour le test (exercice 2071).
 */
const { db, request, app, login, api, PDF } = require('./helpers');
const evaluation = require('../src/services/evaluation');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });

const A = 2071;

describe('Évaluation des politiques sectorielles et budgétaires', () => {
  let prg; let cbprg; let sev; let dir; let id; let action1; let programme;
  beforeAll(async () => {
    prg = api(await login('ag.prg1')); cbprg = api(await login('cb.prg')); sev = api(await login('ag.sev1')); dir = api(await login('directeur'));
    // Référentiel, PTBA validé et suivi de l’exécution, crédits (fictifs)
    const ex = await cbprg.post('/planification/exercices', { annee: A, statut: 'EXECUTION' });
    programme = (await cbprg.post('/planification/programmes', { code: 'E31', libelle: 'Programme d’évaluation (essai)', objectif_global: 'Essai' })).body;
    action1 = (await cbprg.post('/planification/actions', { programme_id: programme.id, code: '1', libelle: 'Action évaluée (essai)' })).body;
    const action2 = (await cbprg.post('/planification/actions', { programme_id: programme.id, code: '2', libelle: 'Action projetée (essai)' })).body;
    const service = await db('plan_services').where({ actif: true }).orderBy('id').first();
    const p = (await prg.post('/ptba', { exercice_id: ex.body.id, service_id: service.id, programme_id: programme.id, objectif_global: 'Essai' })).body;
    await prg.put(`/ptba/${p.id}`, { programme_id: programme.id, objectif_global: 'Essai', objectifs: [
      { libelle: 'Objectif d’essai', lignes: [
        { activite: 'Activité A (essai)', cout: 100000000, mois: [1, 2], action_id: action1.id },
        { activite: 'Activité B (essai)', cout: 50000000, mois: [3], action_id: action1.id },
        { activite: 'Activité C (essai)', cout: 20000000, mois: [4] },
      ] },
    ] });
    await prg.post(`/ptba/${p.id}/soumettre`);
    await cbprg.post(`/ptba/${p.id}/verifier`, {});
    await api(await login('cd.ps')).post(`/ptba/${p.id}/consolider`, {});
    expect((await dir.post(`/ptba/${p.id}/valider`, {})).status).toBe(200);
    const lignes = (await sev.get(`/ptba/${p.id}`)).body.lignes;
    await sev.put(`/ptba/lignes/${lignes[0].id}/suivi/2`, { taux_physique: 100, montant_engage: 90000000, montant_decaisse: 80000000 });
    await sev.put(`/ptba/lignes/${lignes[1].id}/suivi/2`, { taux_physique: 40, montant_engage: 20000000, montant_decaisse: 10000000 });
    const poste = await db('plan_postes_budgetaires').where({ axe: 'RUBRIQUE', code: 'FONC' }).first();
    await cbprg.put('/programmation/credits', { lignes: [
      { annee: A, type: 'VOTE', programme_id: programme.id, poste_id: poste.id, montant: 200000000 },
      { annee: A + 1, type: 'PREVISION', programme_id: programme.id, action_id: action2.id, poste_id: poste.id, montant: 30000000 },
      { annee: A + 3, type: 'PREVISION', programme_id: programme.id, action_id: action2.id, poste_id: poste.id, montant: 45000000 },
    ] });
  });

  test('ouverture réservée au Bureau Suivi-Évaluation ; annexes reprises du SIG-DEP', async () => {
    const corps = { annee: A, convocation_reference: 'Lettre n° 001/BUDGET/2071 (essai)', convocation_date: `${A}-06-02`, date_limite: `${A}-07-15` };
    expect((await prg.post('/evaluations', corps)).status).toBe(403);
    expect((await dir.post('/evaluations', corps)).status).toBe(403);
    expect((await sev.post('/evaluations', { ...corps, annee_projection: A + 5 })).status).toBe(400);
    const r = await sev.post('/evaluations', corps);
    expect(r.status).toBe(201);
    id = r.body.id;
    expect(r.body).toMatchObject({ reference: expect.stringMatching(/^DEP\/EVAL\/\d{4}\/\d{4}$/), annee_projection: A + 1, statut: 'PREPARATION' });
    expect((await sev.post('/evaluations', corps)).status).toBe(409);
    // Le Bureau Programme est invité à compléter la projection
    const u = await db('users').where({ username: 'ag.prg1' }).first();
    expect(await db('notifications').where({ user_id: u.id, type: 'EVALUATION' }).first()).toBeDefined();

    const d = (await sev.get(`/evaluations/${id}`)).body;
    // Annexe I : par action (taux recalculé), puis par objectif pour les lignes sans action
    const I = d.annexes.I.lignes;
    const a1 = I.find((l) => l.cle === `ACTION:${action1.id}`);
    expect(a1.valeurs).toMatchObject({ prevision: 150000000, execution: 90000000, niveau_physique: 'PARTIEL' });
    expect(a1.calculs.taux).toBe(60);
    expect(I.find((l) => l.cle.startsWith('OBJECTIF:')).valeurs).toMatchObject({ prevision: 20000000, execution: 0, niveau_physique: 'NON_ENTAME' });
    expect(d.annexes.I.totaux).toMatchObject({ prevision: 170000000, execution: 90000000, taux: 52.9 });
    // Annexe II : prévisions par action sur la période de projection
    const II = d.annexes.II.lignes.find((l) => l.valeurs.action.includes('Action projetée'));
    expect(II.valeurs).toMatchObject({ montant_1: 30000000, montant_2: 0, montant_3: 45000000 });
    expect(II.calculs.total).toBe(75000000);
    expect(d.projection).toEqual([A + 1, A + 2, A + 3]);
    // Annexes III et IV : effectifs par grade (organique et affecté)
    const III = d.annexes.III;
    expect(III.lignes.length).toBeGreaterThan(3);
    expect(III.totaux.organique).toBe((await db('effectif_structure').sum('nombre as n').first()).n * 1);
    expect(III.lignes.every((l) => l.valeurs.paye === undefined)).toBe(true);
    // Annexe V : dotation (crédits votés), engagé et payé (suivi des PTBA validés)
    const V = d.annexes.V.lignes.find((l) => l.cle === `PROGRAMME:${programme.id}`);
    expect(V.valeurs).toMatchObject({ dotation: 200000000, engage: 110000000, paye: 90000000 });
    expect(V.calculs).toEqual({ non_paye: 20000000, pourcentage: 55 });
    // Contrôles : champs à renseigner signalés
    expect(d.controle.erreurs).toBeGreaterThan(0);
    expect(d.anomalies).toEqual(expect.arrayContaining([
      expect.objectContaining({ annexe: 'I', gravite: 'ERREUR', message: expect.stringMatching(/Reconduction/) }),
      expect.objectContaining({ annexe: 'II', gravite: 'ERREUR', message: expect.stringMatching(/PAG/) }),
      expect.objectContaining({ annexe: 'III', gravite: 'ALERTE', message: expect.stringMatching(/Ressources Humaines/) }),
    ]));
    expect(d.droits).toMatchObject({ modifier: true, annexes: { I: true, II: true, V: true } });
    // Files « À traiter » : dossier à compléter (Suivi-Évaluation), projection à compléter (Programme)
    const fSev = (await sev.get('/dashboard/a-traiter')).body.files.find((f) => f.cle === 'evaluations_preparer');
    expect(fSev.items[0]).toMatchObject({ to: `/evaluations/${id}`, echeance: `${A}-07-15` });
    expect((await prg.get('/dashboard/a-traiter')).body.files.find((f) => f.cle === 'evaluations_projection').items[0].to).toBe(`/evaluations/${id}?onglet=II`);
    expect((await sev.get('/dashboard/compteurs')).body.evaluations).toBeGreaterThan(0);
  });

  test('saisie, contrôles des formules et valeurs modifiées', async () => {
    let d = (await sev.get(`/evaluations/${id}`)).body;
    const a1 = d.annexes.I.lignes.find((l) => l.cle === `ACTION:${action1.id}`);
    // Le niveau physique « total » contredit le taux physique pondéré (80 %) : alerte
    let r = await sev.put(`/evaluations/${id}/lignes/${a1.id}`, { valeurs: { niveau_physique: 'TOTAL', reconduction: true, cible: 'Services du Ministère (essai)', execution: 160000000 } });
    expect(r.status).toBe(200);
    expect(r.body.calculs.taux).toBe(106.7);
    expect(r.body.anomalies.map((a) => a.message).join(' | ')).toMatch(/supérieure à la prévision.*\|.*incohérent/);
    d = (await sev.get(`/evaluations/${id}`)).body;
    expect(d.annexes.I.lignes.find((l) => l.id === a1.id).modifies.sort()).toEqual(['execution', 'niveau_physique']);
    // Effectifs : payé + non payé doit égaler l’affecté
    const g = d.annexes.III.lignes.find((l) => l.valeurs.affecte > 0);
    r = await sev.put(`/evaluations/${id}/lignes/${g.id}`, { valeurs: { paye: g.valeurs.affecte, non_paye: 1 } });
    expect(r.body.anomalies).toEqual([expect.objectContaining({ gravite: 'ERREUR', message: expect.stringMatching(/≠ affecté/) })]);
    r = await sev.put(`/evaluations/${id}/lignes/${g.id}`, { valeurs: { paye: g.valeurs.affecte - 1, non_paye: 1 } });
    expect(r.body.anomalies).toEqual([]);
    // Annexe V : payé au-delà de l’engagé refusé par le contrôle
    const v = d.annexes.V.lignes.find((l) => l.cle === `PROGRAMME:${programme.id}`);
    r = await sev.put(`/evaluations/${id}/lignes/${v.id}`, { valeurs: { paye: 120000000 } });
    expect(r.body.calculs.non_paye).toBe(-10000000);
    expect(r.body.anomalies.some((a) => a.gravite === 'ERREUR' && /payées supérieures/.test(a.message))).toBe(true);
    await sev.put(`/evaluations/${id}/lignes/${v.id}`, { valeurs: { paye: 90000000 } });
    // Ligne ajoutée (projet hors SIG-DEP) puis supprimée ; ligne reprise écartée puis rétablie
    r = await sev.post(`/evaluations/${id}/lignes`, { annexe: 'I', valeurs: { action: 'Projet hors PTBA (essai)', prevision: 1000, execution: 500, niveau_physique: 'PARTIEL', reconduction: false } });
    expect(r.status).toBe(201);
    expect((await sev.post(`/evaluations/${id}/lignes/${r.body.id}/ecarter`, { exclue: true })).status).toBe(400);
    expect((await sev.del(`/evaluations/${id}/lignes/${r.body.id}`)).status).toBe(200);
    expect((await sev.del(`/evaluations/${id}/lignes/${a1.id}`)).status).toBe(400);
    expect((await sev.post(`/evaluations/${id}/lignes/${a1.id}/ecarter`, { exclue: true })).status).toBe(200);
    d = (await sev.get(`/evaluations/${id}`)).body;
    expect(d.annexes.I.ecartees.map((l) => l.id)).toEqual([a1.id]);
    expect(d.annexes.I.totaux.prevision).toBe(20000000);
    await sev.post(`/evaluations/${id}/lignes/${a1.id}/ecarter`, { exclue: false });
  });

  test('Bureau Programme : annexe II seulement ; actualisation conservant les valeurs modifiées', async () => {
    const d = (await prg.get(`/evaluations/${id}`)).body;
    expect(d.droits).toMatchObject({ modifier: false, annexes: { I: false, II: true, III: false, V: false } });
    const II = d.annexes.II.lignes.find((l) => l.valeurs.action.includes('Action projetée'));
    expect((await prg.put(`/evaluations/${id}/lignes/${II.id}`, { valeurs: { etude_faisabilite: true, objectif_pag: 'Pilier numérique du PAG (essai)', impact_environnemental: 'Faible', montant_2: 40000000 } })).status).toBe(200);
    const I = d.annexes.I.lignes[0];
    expect((await prg.put(`/evaluations/${id}/lignes/${I.id}`, { valeurs: { cible: 'x' } })).status).toBe(403);
    expect((await prg.post(`/evaluations/${id}/annexes/I/actualiser`)).status).toBe(403);
    // Nouvelle prévision dans les crédits : reprise pour la valeur non modifiée, la valeur saisie reste
    const poste = await db('plan_postes_budgetaires').where({ axe: 'RUBRIQUE', code: 'FONC' }).first();
    const action2 = await db('plan_actions').where({ programme_id: programme.id, code: '2' }).first();
    await cbprg.put('/programmation/credits', { lignes: [
      { annee: A + 1, type: 'PREVISION', programme_id: programme.id, action_id: action2.id, poste_id: poste.id, montant: 35000000 },
      { annee: A + 2, type: 'PREVISION', programme_id: programme.id, action_id: action2.id, poste_id: poste.id, montant: 99000000 },
    ] });
    const b = await prg.post(`/evaluations/${id}/annexes/II/actualiser`);
    expect(b.body).toMatchObject({ actualisees: 1 });
    const apres = (await prg.get(`/evaluations/${id}`)).body.annexes.II.lignes.find((l) => l.id === II.id);
    expect(apres.valeurs).toMatchObject({ montant_1: 35000000, montant_2: 40000000, montant_3: 45000000, objectif_pag: 'Pilier numérique du PAG (essai)' });
    expect(apres.source.montant_2).toBe(99000000);
    expect(apres.modifies).toEqual(['montant_2']);
    expect(apres.anomalies).toEqual([]);
    // Historique et période de projection décalée
    const r = await sev.put(`/evaluations/${id}`, { convocation_reference: 'Lettre n° 001/BUDGET/2071 (essai)', convocation_date: `${A}-06-02`, date_limite: `${A}-07-15`, annee_projection: A + 2 });
    expect(r.body.annee_projection).toBe(A + 2);
    const d2 = (await sev.get(`/evaluations/${id}`)).body;
    expect(d2.projection).toEqual([A + 2, A + 3, A + 4]);
    expect(d2.annexes.II.lignes.find((l) => l.id === II.id).source).toMatchObject({ montant_1: 99000000, montant_2: 45000000, montant_3: 0 });
    expect(d2.historique.map((h) => h.action)).toEqual(expect.arrayContaining(['CREATION', 'ACTUALISATION', 'LIGNE_AJOUTEE', 'LIGNE_ECARTEE', 'MODIFICATION']));
  });

  test('pièces jointes : convocation et états de la DRH par le Bureau Suivi-Évaluation ; accès', async () => {
    const tSev = await login('ag.sev1');
    const depot = await request(app).post(`/api/attachments/EVALUATION/${id}`).set('Authorization', `Bearer ${tSev}`).attach('fichiers', PDF, { filename: 'etats-drh-essai.pdf', contentType: 'application/pdf' });
    expect(depot.status).toBe(201);
    const tPrg = await login('ag.prg1');
    expect((await request(app).post(`/api/attachments/EVALUATION/${id}`).set('Authorization', `Bearer ${tPrg}`).attach('fichiers', PDF, { filename: 'x.pdf', contentType: 'application/pdf' })).status).toBe(403);
    expect((await sev.get(`/evaluations/${id}`)).body.pieces).toBe(1);
    // Le SG ne voit le dossier qu’une fois validé
    const sg = api(await login('sg'));
    expect((await sg.get('/evaluations')).body.data).toEqual([]);
    expect((await sg.get(`/evaluations/${id}`)).status).toBe(403);
    expect((await dir.get(`/evaluations/${id}`)).body.droits.modifier).toBe(false);
  });

  test('circuit : note, soumission, vérification, retour, validation (lettre numérotée), transmission et CDS-MT', async () => {
    const cdps = api(await login('cd.ps')); const sec = api(await login('cb.secretariat'));
    // Lever les erreurs restantes des annexes
    let d = (await sev.get(`/evaluations/${id}`)).body;
    const corrections = { I: { niveau_physique: 'PARTIEL', reconduction: false, cible: 'Usagers (essai)' }, II: { etude_faisabilite: false, objectif_pag: 'PAG (essai)', impact_environnemental: 'Nul' } };
    for (const code of ['I', 'II']) {
      for (const l of d.annexes[code].lignes.filter((x) => x.anomalies.some((a) => a.gravite === 'ERREUR'))) {
        expect((await sev.put(`/evaluations/${id}/lignes/${l.id}`, { valeurs: corrections[code] })).status).toBe(200);
      }
    }
    for (const code of ['III', 'IV']) {
      for (const l of d.annexes[code].lignes.filter((x) => x.anomalies.some((a) => a.gravite === 'ERREUR'))) await sev.put(`/evaluations/${id}/lignes/${l.id}`, { valeurs: { paye: l.valeurs.affecte, non_paye: 0 } });
    }
    d = (await sev.get(`/evaluations/${id}`)).body;
    expect(d.controle.erreurs).toBe(0);
    expect(d.bloquants).toEqual(expect.arrayContaining([expect.stringMatching(/Note de présentation : rubrique « Contexte »/)]));
    expect(d.resume_propose).toMatch(/taux d’exécution de 94,1 %/);
    expect(d.lettre).toMatchObject({ destinataire: 'Monsieur le Secrétaire Général au Numérique', references: 'Convocation : Lettre n° 001/BUDGET/2071 (essai)' });
    let r = await sev.post(`/evaluations/${id}/soumettre`);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/rubrique « Contexte »/);
    // Note et lettre : rédigées par le Bureau Suivi-Évaluation seulement
    const note = { contexte: 'Contexte (essai).', presentation: 'Présentation (essai).', resume: d.resume_propose, perspectives: 'Perspectives (essai).', attentes: 'Attentes (essai).' };
    expect((await prg.put(`/evaluations/${id}/note`, note)).status).toBe(403);
    expect((await sev.put(`/evaluations/${id}/note`, note)).status).toBe(200);
    expect((await sev.put(`/evaluations/${id}/lettre`, { ...d.lettre, copies: ['Monsieur le Directeur de Cabinet (essai)'] })).status).toBe(200);
    expect((await sev.post(`/evaluations/${id}/soumettre`)).body.statut).toBe('SOUMIS');
    expect((await sev.put(`/evaluations/${id}/note`, note)).status).toBe(403);
    // Vérification : Chef de la Division Programme et Suivi uniquement ; retour par le Directeur
    expect((await dir.post(`/evaluations/${id}/verifier`)).status).toBe(403);
    expect((await cdps.get('/dashboard/a-traiter')).body.files.find((f) => f.cle === 'evaluations_verifier').items[0].to).toBe(`/evaluations/${id}`);
    expect((await cdps.post(`/evaluations/${id}/verifier`)).body.statut).toBe('VERIFIE');
    r = await dir.post(`/evaluations/${id}/retourner`, { motif: 'Préciser les attentes (essai).' });
    expect(r.body).toMatchObject({ statut: 'A_CORRIGER', observations: 'Préciser les attentes (essai).' });
    await sev.put(`/evaluations/${id}/note`, { ...note, attentes: 'Attentes précisées (essai).' });
    await sev.post(`/evaluations/${id}/soumettre`);
    await cdps.post(`/evaluations/${id}/verifier`);
    // Validation : la lettre reçoit son numéro officiel (séquence de la correspondance)
    expect((await dir.get('/dashboard/a-traiter')).body.files.find((f) => f.cle === 'evaluations_valider')).toBeDefined();
    expect((await sev.post(`/evaluations/${id}/transmettre`)).status).toBe(403);
    r = await dir.post(`/evaluations/${id}/valider`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ statut: 'VALIDE', numero_lettre: expect.stringMatching(/^N° \d{3}\//) });
    const numero = r.body.numero_lettre;
    const lettre = await binaire(sev.get(`/evaluations/${id}/lettre/pdf`));
    expect(lettre.body.slice(0, 4).toString()).toBe('%PDF');
    const pdf = await binaire(sev.get(`/evaluations/${id}/export/pdf`));
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    const xlsx = await binaire(sev.get(`/evaluations/${id}/export/xlsx`));
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Annexe I', 'Annexe II', 'Annexe III', 'Annexe IV', 'Annexe V']);
    const formules = []; wb.getWorksheet('Annexe I').eachRow((row) => row.eachCell((c) => { if (c.formula) formules.push(c.formula); }));
    expect(formules.some((f) => /^SUM\(/.test(f))).toBe(true);
    expect(formules.some((f) => /^IF\(B\d+=0/.test(f))).toBe(true);
    // Le SG voit le dossier validé ; transmission par le Secrétariat de Direction, report dans le CDS-MT
    const sg = api(await login('sg'));
    expect((await sg.get(`/evaluations/${id}`)).status).toBe(200);
    expect((await sg.post(`/evaluations/${id}/transmettre`)).status).toBe(403);
    expect((await sec.get('/dashboard/a-traiter')).body.files.find((f) => f.cle === 'evaluations_transmettre').items[0].detail).toBe(`Lettre ${numero}`);
    r = await sec.post(`/evaluations/${id}/transmettre`);
    expect(r.body).toMatchObject({ statut: 'TRANSMIS' });
    expect(r.body.cdsmt).toBeGreaterThan(0);
    const c = (await sg.get('/evaluations/cdsmt')).body;
    const ligne = c.lignes.find((l) => l.action.includes('Action projetée'));
    expect(ligne).toMatchObject({ objectif_pag: 'Pilier numérique du PAG (essai)', etude_faisabilite: true });
    expect(ligne.montants[A + 2]).toBe(99000000);
    const u = await db('users').where({ username: 'sg' }).first();
    expect(await db('notifications').where({ user_id: u.id, type: 'EVALUATION' }).first()).toBeDefined();
    const h = (await sg.get(`/evaluations/${id}`)).body.historique.map((x) => x.action);
    expect(h).toEqual(expect.arrayContaining(['SOUMISSION', 'VERIFICATION', 'RETOUR_CORRECTION', 'VALIDATION', 'TRANSMISSION']));
  });

  test('dossier transmis intangible en base ; CDS-MT en ajout seul', async () => {
    await expect(db('evaluation_lignes').where({ evaluation_id: id }).update({ exclue: true })).rejects.toThrow(/EVALUATION_VERROUILLEE/);
    await expect(db('evaluations').where({ id }).update({ note: JSON.stringify({ contexte: 'x' }) })).rejects.toThrow(/EVALUATION_VERROUILLEE/);
    await expect(db('evaluations').where({ id }).update({ lettre: JSON.stringify({ objet: 'x' }) })).rejects.toThrow(/EVALUATION_VERROUILLEE/);
    await expect(db('evaluations').where({ id }).update({ statut: 'PREPARATION' })).rejects.toThrow(/EVALUATION_VERROUILLEE/);
    await expect(db('evaluations').where({ id }).update({ transmis_at: db.fn.now() })).rejects.toThrow(/EVALUATION_VERROUILLEE/);
    expect((await sev.put(`/evaluations/${id}/lignes/${(await db('evaluation_lignes').where({ evaluation_id: id }).first()).id}`, { valeurs: { cible: 'x' } })).status).toBe(403);
    await expect(db('evaluations').where({ id }).del()).rejects.toThrow(/EVALUATION_VERROUILLEE/);
    await expect(db('cdsmt_projections').where({ evaluation_id: id }).update({ montant: 1 })).rejects.toThrow(/APPEND_ONLY/);
  });

  test('contrôles unitaires', () => {
    expect(evaluation.controlerLigne('V', { programme: 'P', dotation: 100, engage: 30, paye: 10 }).map((a) => a.message)).toEqual(['Exécution inférieure à 50 % sans observation.']);
    expect(evaluation.calculs('V', { dotation: 0, engage: 5, paye: 5 })).toEqual({ non_paye: 0, pourcentage: null });
    expect(evaluation.normaliser('I', { reconduction: 'true', niveau_physique: 'X', prevision: '12.345', inconnu: 1 })).toEqual({ reconduction: true, niveau_physique: null, prevision: 12.35 });
  });
});
