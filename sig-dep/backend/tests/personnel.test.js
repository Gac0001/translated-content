'use strict';
/**
 * Lot C (1.41.0) — Effectif par structure et par grade, versions du référentiel, données
 * personnelles masquées selon le rôle, groupes de travail, rapport d’anomalies de l’import.
 */
const { db, request, app, login, api, PDF } = require('./helpers');
const { analyse } = require('../src/services/importAgents');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
const agentDe = async (username) => (await db('users').where({ username }).first('agent_id')).agent_id;

describe('Effectifs par structure et par grade', () => {
  test('organique du cadre (§ 10) comparé au réel, vacances, sureffectifs, exports', async () => {
    const dir = api(await login('directeur'));
    const r = await dir.get('/organisation/effectifs/structures');
    expect(r.status).toBe(200);
    expect(r.body.totaux.prevu).toBe(20);
    const bsd = r.body.structures.find((s) => s.code === 'BSD');
    expect(bsd.prevu).toBe(3);
    expect(bsd.detail.map((d) => d.critere)).toEqual(expect.arrayContaining(['CB', 'ATA1', 'F-HUI']));
    const prg = r.body.structures.find((s) => s.code === 'BUR-PRG');
    expect(prg.detail.find((d) => d.critere === 'ATA2').prevu).toBe(1);
    expect(r.body.structures[0].code).toBe('DIRECTION');
    for (const s of r.body.structures) expect(s.reel - s.prevu).toBe(s.sureffectifs - s.vacances);
    expect(r.body.colonnes.map((c) => c.libelle)).toContain('140 — Chef de Bureau');
    const pdf = await binaire(dir.get('/organisation/effectifs/export/pdf'));
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    const xlsx = await binaire(dir.get('/organisation/effectifs/export/xlsx'));
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    // Le tableau de bord du Directeur reprend les totaux
    expect((await dir.get('/dashboard')).body.effectif.parStructure).toMatchObject({ prevu: 20 });
  });

  test('référentiel versionné : version initiale, modification, nouvelle version consignée', async () => {
    const dir = api(await login('directeur'));
    let v = await dir.get('/organisation/referentiel/versions');
    expect(v.body.data.at(-1)).toMatchObject({ numero: 1, source: expect.stringMatching(/cahier des charges/) });
    // Changements apportés par d’autres scénarios (Bureaux créés) : consignés d’abord
    if (v.body.enAttente.length) expect((await dir.post('/organisation/referentiel/versions', { source: 'Mise à jour des structures (essai)', date_application: '2026-10-12' })).status).toBe(201);
    v = await dir.get('/organisation/referentiel/versions');
    expect(v.body.enAttente).toEqual([]);
    const numero = v.body.data[0].numero;
    expect((await dir.post('/organisation/referentiel/versions', { source: 'Note sans changement', date_application: '2026-10-13' })).status).toBe(400);
    // Un poste d’emploi supplémentaire (Attaché de 2e classe) au Bureau Suivi-Évaluation
    expect((await api(await login('cb.coi')).put('/organisation/effectifs/structures', { structure_code: 'BUR-SEV', critere_type: 'GRADE', critere_code: 'ATA2', nombre: 1, source: 'Essai' })).status).toBe(403);
    const m = await dir.put('/organisation/effectifs/structures', { structure_code: 'BUR-SEV', critere_type: 'GRADE', critere_code: 'ATA2', nombre: 1, source: 'Décision n° 012/DEP/2026 (essai)' });
    expect(m.status).toBe(200);
    const att = (await dir.get('/organisation/referentiel/versions')).body.enAttente;
    expect(att).toEqual([expect.objectContaining({ partie: 'effectif_structure', element: 'BUR-SEV/ATA2', nature: 'AJOUT' })]);
    const n = await dir.post('/organisation/referentiel/versions', { source: 'Décision n° 012/DEP/2026 (essai)', date_application: '2026-10-13', observation: 'Poste d’Attaché au Suivi-Évaluation' });
    expect(n.status).toBe(201);
    expect(n.body.numero).toBe(numero + 1);
    const detail = (await dir.get(`/organisation/referentiel/versions/${n.body.id}`)).body;
    expect(detail.changements).toHaveLength(1);
    await expect(db('referentiel_versions').where({ id: n.body.id }).del()).rejects.toThrow(/APPEND_ONLY|ne se modifie/);
    expect((await dir.get('/organisation/effectifs/structures')).body.totaux.prevu).toBe(21);
  });
});

describe('Données personnelles masquées selon le rôle', () => {
  test('Chef de Bureau : coordonnées professionnelles seulement ; Directeur, Secrétariat et agent : tout', async () => {
    const id = await agentDe('ag.coi1');
    await db('agents').where({ id }).update({ date_naissance: '1990-05-05', adresse: 'Avenue fictive 1', telephone: '+243 000 000 001', numero_carte_igap: 'IGAP-FICTIF-01' });
    const chef = (await api(await login('cb.coi')).get(`/agents/${id}`)).body;
    expect(chef).toMatchObject({ donnees_masquees: true, date_naissance: null, adresse: null, telephone: null, numero_carte_igap: null });
    expect(chef.matricule).toBeTruthy();
    const liste = (await api(await login('cb.coi')).get('/agents')).body.data.find((a) => a.id === id);
    expect(liste.telephone).toBeNull();
    for (const u of ['directeur', 'cb.secretariat', 'ag.coi1']) {
      const f = (await api(await login(u)).get(`/agents/${id}`)).body;
      expect(f.adresse).toBe('Avenue fictive 1');
      expect(f.donnees_masquees).toBeUndefined();
    }
    const sg = (await api(await login('sg')).get(`/agents/${id}`)).body;
    expect(sg.telephone).toBeNull();
  });
});

describe('Groupes de travail', () => {
  let dir; let groupe;
  beforeAll(async () => { dir = api(await login('directeur')); });

  test('création réservée au Directeur et au Secrétariat, membres, participants externes', async () => {
    const corps = { nom: 'Cellule Genre (essai)', objet: 'Prise en compte du genre dans les activités de la Direction.', acte_reference: 'Note de service n° 020/DEP/2026 (essai)', date_debut: '2026-10-01' };
    expect((await api(await login('cb.coi')).post('/groupes', corps)).status).toBe(403);
    const r = await dir.post('/groupes', corps);
    expect(r.status).toBe(201);
    groupe = r.body;
    expect(groupe.code).toMatch(/^GT-2026-\d{3}$/);
    const sec = api(await login('cb.secretariat'));
    expect((await sec.post(`/groupes/${groupe.id}/membres`, { agent_id: await agentDe('ag.coi1'), role: 'COORDONNATEUR' })).status).toBe(201);
    expect((await sec.post(`/groupes/${groupe.id}/membres`, { agent_id: await agentDe('ag.eap1'), role: 'COORDONNATEUR' })).status).toBe(409);
    expect((await sec.post(`/groupes/${groupe.id}/membres`, { agent_id: await agentDe('ag.eap1'), role: 'RAPPORTEUR' })).status).toBe(201);
    expect((await sec.post(`/groupes/${groupe.id}/membres`, { agent_id: await agentDe('ag.eap1'), role: 'MEMBRE' })).status).toBe(409);
    const p = await sec.post(`/groupes/${groupe.id}/participants`, { nom: 'Représentant fictif', service: 'Direction des Ressources Humaines' });
    expect(p.body.participants).toHaveLength(1);
    expect(p.body.membres.map((m) => m.role)).toEqual(['COORDONNATEUR', 'RAPPORTEUR']);
    // L’appartenance ne change ni l’affectation ni le rôle
    const roles = await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').join('users as u', 'u.id', 'ur.user_id').where('u.username', 'ag.coi1').pluck('r.code');
    expect(roles).toEqual(['AGENT']);
    // Notification du membre
    const u = await db('users').where({ username: 'ag.coi1' }).first();
    expect(await db('notifications').where({ user_id: u.id }).where('titre', 'like', '%Cellule Genre (essai)%').first()).toBeDefined();
  });

  test('accès : les membres voient le groupe et déposent des dossiers ; les autres non', async () => {
    const membre = await login('ag.coi1');
    expect((await api(membre).get('/groupes')).body.data.map((g) => g.id)).toContain(groupe.id);
    const depot = await request(app).post(`/api/attachments/GROUPE/${groupe.id}`).set('Authorization', `Bearer ${membre}`).attach('fichiers', PDF, { filename: 'compte-rendu.pdf', contentType: 'application/pdf' });
    expect(depot.status).toBe(201);
    const autre = api(await login('ag.str1'));
    expect((await autre.get('/groupes')).body.data.map((g) => g.id)).not.toContain(groupe.id);
    expect((await autre.get(`/groupes/${groupe.id}`)).status).toBe(403);
    expect((await autre.get(`/attachments/GROUPE/${groupe.id}`)).status).toBe(403);
    // Structure responsable d’une activité : le groupe actif est proposé
    expect((await autre.get('/groupes/responsables')).body.data).toEqual(expect.arrayContaining([{ nom: 'Cellule Genre (essai)', type: 'GROUPE' }]));
    // Un groupe ne compte jamais dans l’effectif
    const eff = (await dir.get('/organisation/effectifs/structures')).body;
    expect(eff.structures.some((s) => /Cellule/.test(s.nom))).toBe(false);
  });

  test('clôture : membres retirés, groupe en lecture seule', async () => {
    const r = await dir.post(`/groupes/${groupe.id}/cloturer`, { date_fin: '2026-10-13', motif: 'Mission accomplie (essai)' });
    expect(r.body).toMatchObject({ statut: 'CLOS', droits: { gerer: false, deposer: false } });
    expect(r.body.membres.every((m) => m.date_fin)).toBe(true);
    expect((await dir.post(`/groupes/${groupe.id}/participants`, { nom: 'Après clôture' })).status).toBe(403);
    expect(r.body.historique.map((h) => h.action)).toEqual(expect.arrayContaining(['CREATION', 'MEMBRE_AJOUTE', 'PARTICIPANT_AJOUTE', 'CLOTURE']));
  });
});

describe('Import du personnel : rapport d’anomalies', () => {
  test('anciennes appellations de grade, doublons de nom, cohérence du grade et du poste', async () => {
    const [bureaux, divisions, grades] = await Promise.all([db('bureaux').where({ actif: true }), db('divisions').where({ actif: true }), db('grades').where({ actif: true })]);
    const rows = [
      ['N°', 'Nom', 'Postnom', 'Prénom', 'Matricule', 'Grade'],
      ['1. Bureau Stratégies'],
      ['1', 'TSHIBOLA', 'KANDA', 'Jean', '700.001', 'Attaché d’Administration de 1re classe'],
      ['2', 'TSHIBOLA', 'KANDA', 'Jean', '700.002', '210'],
      ['3', 'MUTOMBO', 'LUKUSA', 'Paul', '700.003', 'Chef de Division'],
      ['4', 'ILUNGA', 'KABONGO', 'Rose', '700.004', 'Inconnu'],
    ];
    const r = analyse(rows, { bureaux, divisions, grades, existants: new Map(), existantsNoms: new Map(), chefsEnPoste: new Set() });
    const msg = (i) => r.lignes[i].anomalies.map((a) => a.message).join(' | ');
    expect(r.lignes[0].grade_officiel).toBe('210 — Attaché d’Administration de 1re classe');
    expect(msg(0)).toMatch(/reconnu : 210/);
    expect(msg(0)).toMatch(/doublon possible/);
    expect(msg(1)).not.toMatch(/reconnu/);
    expect(msg(2)).toMatch(/Chef de Division\) dans un Bureau/);
    expect(msg(3)).toMatch(/inconnu du référentiel/);
  });
});
