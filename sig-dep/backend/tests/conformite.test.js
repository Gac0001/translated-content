'use strict';
/**
 * Lot 4 — Conformité au cadre organique : codes 5.3.3, appellations officielles,
 * effectif organique de référence comparé à l’effectif réel.
 */
const { db, login, api } = require('./helpers');
const { STATUTS_EFFECTIF } = require('../src/services/effectifs');

describe('Conformité au cadre organique', () => {
  let dir; let agent; let sg;
  beforeAll(async () => {
    dir = api(await login('directeur'));
    agent = api(await login('ag.secretariat1'));
    sg = api(await login('sg'));
  });

  test('codes organiques 5.3.3 dans l’organigramme et appellations officielles', async () => {
    const o = (await dir.get('/organisation/organigramme')).body;
    expect(o.direction.codeOrganique).toBe('5.3.3');
    expect(o.direction.autoriteTutelle).toBe('Secrétariat Général au Numérique');
    const bsd = o.bureauxRattachesDirection.find((b) => b.estSecretariatDirection);
    expect(bsd).toMatchObject({ codeOrganique: '5.3.3.0', nom: 'Bureau Secrétariat de Direction' });
    // D’autres tests peuvent créer des Divisions sans code : seules les trois Divisions officielles sont contrôlées.
    const officielles = o.divisions.filter((d) => ['DIV-EDI', 'DIV-SCI', 'DIV-PS'].includes(d.code));
    expect(officielles.map((d) => d.codeOrganique)).toEqual(['5.3.3.1', '5.3.3.2', '5.3.3.3']);
    const codes = officielles.flatMap((d) => d.bureaux.map((b) => [b.codeOrganique, b.nom]));
    expect(codes).toEqual(expect.arrayContaining([
      ['5.3.3.1.1', 'Bureau Études, Analyses et Prospective'], ['5.3.3.1.2', 'Bureau Documentation et Information'],
      ['5.3.3.2.1', 'Bureau Stratégies'], ['5.3.3.2.2', 'Bureau Coopération Internationale'],
      ['5.3.3.3.1', 'Bureau Programme'], ['5.3.3.3.2', 'Bureau Suivi-Évaluation'],
    ]));
    // Le Secrétariat (5.3.3.0) n’est pas compté parmi les Divisions.
    expect(o.divisions.some((d) => d.codeOrganique === '5.3.3.0')).toBe(false);
    const p = await db('parametres').where({ cle: 'autorite_tutelle' }).first();
    expect(p.valeur).toBe('Secrétariat Général au Numérique');
  });

  test('contraintes en base : format, unicité, suffixe .0 réservé au Secrétariat', async () => {
    await expect(db('bureaux').where({ code: 'BSD' }).update({ code_organique: '5.3.3.4' })).rejects.toThrow(/bureaux_secretariat_code_chk/);
    await expect(db('bureaux').where({ code: 'BUR-STR' }).update({ code_organique: '5.3.3.1.1' })).rejects.toThrow(/code_organique_uniq/);
    await expect(db('divisions').where({ code: 'DIV-PS' }).update({ code_organique: '5.3.3.x' })).rejects.toThrow(/code_organique_chk/);
  });

  test('API : le code prolonge celui de la structure de rattachement ; absent = inchangé', async () => {
    const div = await db('divisions').where({ code: 'DIV-EDI' }).first();
    const mauvais = await dir.post('/organisation/bureaux', { code: 'BUR-T1', nom: 'Bureau Test Un', code_organique: '5.3.3.2.9', rattachement: 'DIVISION', division_id: div.id });
    expect(mauvais.status).toBe(400);
    expect(mauvais.body.error.message).toMatch(/5\.3\.3\.1\.N/);
    expect((await dir.post('/organisation/bureaux', { code: 'BUR-T2', nom: 'Bureau Test Deux', code_organique: '5.3.3.1.1', rattachement: 'DIVISION', division_id: div.id })).status).toBe(400);
    expect((await dir.post('/organisation/bureaux', { code: 'BUR-T3', nom: 'Bureau Test Trois', code_organique: '5.3.3.0', rattachement: 'DIRECTION' })).status).toBe(400);

    const ok = await dir.post('/organisation/bureaux', { code: 'BUR-T4', nom: 'Bureau Test Quatre', code_organique: '5.3.3.1.9', rattachement: 'DIVISION', division_id: div.id });
    expect(ok.status).toBe(201);
    expect(ok.body.code_organique).toBe('5.3.3.1.9');
    try {
      // Poste de Chef de Bureau créé sans titulaire : signalé comme vacant.
      const e = (await dir.get('/organisation/effectifs')).body;
      expect(e.postesVacants).toEqual(expect.arrayContaining([expect.objectContaining({ codeOrganique: '5.3.3.1.9', role: 'CHEF_BUREAU' })]));
      // Modification sans le champ : code conservé.
      const maj = await dir.put(`/organisation/bureaux/${ok.body.id}`, { code: 'BUR-T4', nom: 'Bureau Test Quatre bis', rattachement: 'DIVISION', division_id: div.id });
      expect(maj.status).toBe(200);
      expect(maj.body.code_organique).toBe('5.3.3.1.9');
      // Changement de Division sans nouveau code : refusé (le code ne prolongerait plus celui de la Division).
      const autre = await db('divisions').where({ code: 'DIV-SCI' }).first();
      expect((await dir.put(`/organisation/bureaux/${ok.body.id}`, { code: 'BUR-T4', nom: 'Bureau Test Quatre', rattachement: 'DIVISION', division_id: autre.id })).status).toBe(400);
      // Le Secrétariat garde son code 5.3.3.0.
      const bsd = await db('bureaux').where({ code: 'BSD' }).first();
      expect((await dir.put(`/organisation/bureaux/${bsd.id}`, { code: 'BSD', nom: bsd.nom, code_organique: '5.3.3.5', rattachement: 'DIRECTION' })).status).toBe(400);
    } finally {
      await db('postes_organiques').where({ bureau_id: ok.body.id }).del();
      await db('bureaux').where({ id: ok.body.id }).del();
    }
  });

  test('effectif de référence (20) et effectif réel', async () => {
    const r = await dir.get('/organisation/effectifs');
    expect(r.status).toBe(200);
    const e = r.body;
    expect(e.totaux.prevu).toBe(20);
    expect(e.lignes.map((l) => [l.libelle, l.prevu])).toEqual([
      ['Directeur', 1], ['Chefs de Division', 3], ['Chefs de Bureau', 7],
      ['Attachés d’Administration de 1re classe', 7], ['Attaché d’Administration de 2e classe', 1], ['Huissier', 1],
    ]);
    const attendu = await db('agents as ag').join('affectations as a', 'a.agent_id', 'ag.id')
      .where({ 'a.est_active': true, 'ag.est_autorite': false }).whereNull('ag.archived_at').whereIn('ag.statut', STATUTS_EFFECTIF).count('* as n').first();
    expect(e.totaux.reel).toBe(Number(attendu.n));
    expect(e.totaux.dansReference + e.totaux.horsReference).toBe(e.totaux.reel);
    const dirLigne = e.lignes.find((l) => l.code === 'DIR');
    expect(dirLigne).toMatchObject({ reel: 1, ecart: 0, situation: 'CONFORME' });
    for (const l of e.lignes) expect(l.situation).toBe(l.ecart === 0 ? 'CONFORME' : l.ecart < 0 ? 'VACANCE' : 'SUREFFECTIF');
    // Le Secrétaire Général n’est pas compté dans l’effectif de la DEP.
    const sgAgent = await db('agents').where({ est_autorite: true }).first();
    expect(sgAgent).toBeTruthy();
    // Consultation agrégée possible pour le SG.
    expect((await sg.get('/organisation/effectifs')).status).toBe(200);
  });

  test('un Huissier est compté par sa fonction, quel que soit son grade', async () => {
    const avant = (await dir.get('/organisation/effectifs')).body;
    const hui = await db('fonctions').where({ code: 'F-HUI' }).first();
    const a = await db('agents as ag').join('affectations as af', 'af.agent_id', 'ag.id').where({ 'af.est_active': true, 'ag.est_autorite': false })
      .whereNull('ag.archived_at').whereIn('ag.statut', STATUTS_EFFECTIF).orderBy('ag.id', 'desc').first('ag.id', 'ag.fonction_id');
    await db('agents').where({ id: a.id }).update({ fonction_id: hui.id });
    try {
      const apres = (await dir.get('/organisation/effectifs')).body;
      expect(apres.lignes.find((l) => l.code === 'HUI').reel).toBe(avant.lignes.find((l) => l.code === 'HUI').reel + 1);
      expect(apres.totaux.reel).toBe(avant.totaux.reel);
    } finally {
      await db('agents').where({ id: a.id }).update({ fonction_id: a.fonction_id });
    }
  });

  test('modification de la référence : Directeur seulement, acte requis, auditée', async () => {
    const ligne = await db('effectif_reference').where({ code: 'ATA2' }).first();
    expect((await agent.put(`/organisation/effectifs/${ligne.id}`, { nombre: 2, source: 'Arrêté de test' })).status).toBe(403);
    expect((await dir.put(`/organisation/effectifs/${ligne.id}`, { nombre: 2 })).status).toBe(400);
    try {
      const r = await dir.put(`/organisation/effectifs/${ligne.id}`, { nombre: 2, source: 'Arrêté de test n° 001' });
      expect(r.status).toBe(200);
      expect((await dir.get('/organisation/effectifs')).body.totaux.prevu).toBe(21);
      const trace = await db('audit_logs').where({ entite: 'effectif_reference', entite_id: String(ligne.id) }).orderBy('id', 'desc').first();
      expect(trace).toBeTruthy();
    } finally {
      await db('effectif_reference').where({ id: ligne.id }).update({ nombre: ligne.nombre, source: ligne.source });
    }
  });

  test('tableau de bord du Directeur : effectif, écarts et postes vacants', async () => {
    const d = (await dir.get('/dashboard')).body;
    expect(d.effectif.totaux.prevu).toBe(20);
    expect(Array.isArray(d.effectif.ecarts)).toBe(true);
    expect(Array.isArray(d.effectif.postesVacants)).toBe(true);
  });
});
