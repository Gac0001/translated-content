'use strict';
/**
 * Liste déclarative et enrôlement des agents :
 *  - seuls le Directeur et l’Admin valident la liste ;
 *  - l’Admin enrôle tous les agents ; le Bureau Secrétariat de Direction enrôle ceux des autres structures ;
 *  - les autres utilisateurs n’ont ni l’option ni l’accès.
 */
const { db, login, loginAdmin, api, enroler } = require('./helpers');

/** Crée un agent inscrit (grade ATA1, Bureau Programme) et revalide la liste. */
async function admin_agent() {
  const dir0 = api(await login('directeur'));
  const grade = await db('grades').where({ code: 'ATA1' }).first();
  const n = await dir0.post('/agents', { matricule: `DEP-09${Math.floor(Math.random() * 90) + 10}`, nom: 'CONFIRMATION', prenom: 'Test', grade_id: grade.id });
  const bur = await db('bureaux').where({ code: 'BUR-PRG' }).first();
  const poste = await db('postes_organiques').where({ code: 'P-AG-BUR-PRG' }).first();
  const dir = api(await login('directeur'));
  await dir.post(`/agents/${n.body.id}/affectations`, { bureau_id: bur.id, poste_id: poste.id, date_debut: '2026-09-01' });
  await dir.post('/liste-declarative/valider', {});
  return n.body.id;
}

const agentId = async (nom) => (await db('agents').where({ nom }).first()).id;

async function listeValidee() {
  const dir = api(await login('directeur'));
  const e = await dir.get('/liste-declarative');
  if (e.body.statut !== 'VALIDEE') expect((await dir.post('/liste-declarative/valider', {})).status).toBe(201);
}

describe('Liste déclarative et enrôlement', () => {
  beforeAll(listeValidee);

  test('seuls le Directeur et l’Admin voient et utilisent la validation de la liste', async () => {
    const dir = api(await login('directeur'));
    const e = await dir.get('/liste-declarative');
    expect(e.status).toBe(200);
    expect(e.body.actions.valider).toBe(true);
    expect(e.body.agents.some((a) => a.nom === 'LUFUNDA')).toBe(true);
    // L’Admin Système n’a aucun accès à la liste (décision administrative du Directeur)
    expect((await api(await loginAdmin()).get('/liste-declarative')).status).toBe(403);
    expect((await api(await loginAdmin()).post('/liste-declarative/valider', {})).status).toBe(403);
    for (const u of ['cb.secretariat', 'ag.secretariat1', 'cd.edi', 'ag.eap1']) {
      const c = api(await login(u));
      expect((await c.post('/liste-declarative/valider', {})).status).toBe(403);
      expect((await c.get('/auth/me')).body.user.permissions).not.toContain('liste.valider');
    }
    // Déjà validée et inchangée : pas de double validation
    expect((await dir.post('/liste-declarative/valider', {})).status).toBe(400);
  });

  test('l’option d’enrôlement est réservée à l’Admin et au Bureau Secrétariat de Direction', async () => {
    for (const u of ['cb.secretariat', 'ag.secretariat1', 'ag.secretariat2']) {
      expect((await api(await login(u)).get('/auth/me')).body.user.permissions).toContain('compte.enroler');
    }
    expect((await api(await loginAdmin()).get('/auth/me')).body.user.permissions).toContain('compte.enroler');
    for (const u of ['directeur', 'sg', 'cd.sci', 'cb.str', 'ag.eap1']) {
      const c = api(await login(u));
      expect((await c.get('/auth/me')).body.user.permissions).not.toContain('compte.enroler');
      expect((await c.get('/enrolement/candidats')).status).toBe(403);
    }
    expect((await enroler(await login('cd.sci'), await agentId('MASIKA'), { username: 'interdit.cd' })).status).toBe(403);
    expect((await api(await login('directeur')).post('/users', { agent_id: 1, username: 'x.y', roles: ['AGENT'] })).status).toBe(404);
  });

  test('le Bureau Secrétariat n’enrôle pas les agents du Secrétariat', async () => {
    const token = await login('ag.secretariat1');
    const c = api(token);
    const cand = await c.get('/enrolement/candidats');
    expect(cand.status).toBe(200);
    expect(cand.body.portee).toBe('HORS_SECRETARIAT');
    const odette = cand.body.candidats.find((x) => x.nom === 'LUFUNDA');
    expect(odette.enrolable).toBe(false);
    expect((await c.get(`/enrolement/agents/${odette.agent_id}`)).status).toBe(403);
    expect((await enroler(token, odette.agent_id, { username: 'odette.lufunda' })).status).toBe(403);
    // Les bureaux du Secrétariat ne sont pas proposés comme structure d’affectation
    const ruth = await c.get(`/enrolement/agents/${await agentId('BOLAMBA')}`);
    expect(ruth.body.structures.bureaux.map((b) => b.nom)).not.toContain('Bureau Secrétariat de Direction');
  });

  test('un agent du Secrétariat enrôle un agent de Division avec un formulaire prérempli et contrôlé', async () => {
    const token = await login('ag.secretariat2');
    const id = await agentId('MASIKA');
    const pre = await api(token).get(`/enrolement/agents/${id}`);
    expect(pre.status).toBe(200);
    expect(pre.body.enrolable).toBe(true);
    expect(pre.body.agent).toMatchObject({ nom: 'MASIKA', grade_code: 'ATA2' });
    expect(pre.body.affectation).toMatchObject({ verrouillee: true, bureau_nom: 'Bureau Stratégies' });
    expect(pre.body.usernamePropose).toBe('rodrigue.masika');
    // Fonctions proposées : uniquement celles du grade
    const grade = await db('grades').where({ code: 'ATA2' }).first();
    const fGrade = await db('fonctions').where({ grade_id: grade.id }).pluck('id');
    expect(pre.body.fonctions.map((f) => f.id).sort()).toEqual(fGrade.sort());

    expect((await enroler(token, id, { username: 'rodrigue.masika', photo: false })).status).toBe(400);
    expect((await enroler(token, id, { username: 'rodrigue.masika', commission: false })).status).toBe(400);
    const fAutre = await db('fonctions').where({ code: 'F-CE' }).first();
    const r1 = await enroler(token, id, { username: 'rodrigue.masika', fonction_id: fAutre.id });
    expect(r1.status).toBe(400);
    expect(r1.body.error.message).toMatch(/ne correspond pas au grade/);
    expect((await enroler(token, id, { username: 'rodrigue.masika', date_naissance: '2000-01-01', date_mise_en_service: '2010-01-01' })).status).toBe(400);

    const r = await enroler(token, id, { username: 'rodrigue.masika', sexe: 'M', numero_carte_igap: 'igap-str-001', lieu_naissance: 'Kinshasa' });
    expect(r.status).toBe(201);
    expect(r.body.role).toBe('AGENT');
    const ag = await db('agents').where({ id }).first();
    expect(ag).toMatchObject({ numero_carte_igap: 'IGAP-STR-001', date_mise_en_service: '2010-01-04', lieu_naissance: 'Kinshasa' });
    expect(ag.photo_path).toBeTruthy();
    expect(ag.commission_attachment_id).toBeTruthy();
    expect((await db('users').where({ id: r.body.id }).first()).must_change_password).toBe(true);
    // Pas de second compte
    expect((await enroler(token, id, { username: 'rodrigue.bis' })).status).toBe(403);
    // Commission téléchargeable par le Directeur, jamais par l’Admin Système
    expect((await api(await loginAdmin()).get(`/agents/${id}/commission`)).status).toBe(403);
    const dl = await api(await login('directeur')).get(`/agents/${id}/commission`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toMatch(/pdf/);
  });

  test('l’Admin enrôle seulement les agents du Secrétariat autorisés par le Directeur ; le numéro IGAP est unique', async () => {
    const token = await loginAdmin();
    const id = await agentId('LUFUNDA');
    const dir = api(await login('directeur'));
    // Sans autorisation nominative du Directeur : refusé
    const sans = await enroler(token, id, { username: 'odette.lufunda', numero_carte_igap: 'IGAP-BSD-001' });
    expect(sans.status).toBe(403);
    expect(sans.body.error.message).toMatch(/n’a pas autorisé/);
    // Agent d’une Division : jamais par l’Admin, même si le Directeur tentait de l’autoriser
    expect((await dir.post(`/liste-declarative/agents/${await agentId('BOLAMBA')}/autoriser-enrolement`)).status).toBe(400);
    expect((await api(token).get('/enrolement/candidats')).body.candidats.find((c) => c.nom === 'BOLAMBA').enrolable).toBe(false);
    // Seul le Directeur autorise
    expect((await api(await login('cb.secretariat')).post(`/liste-declarative/agents/${id}/autoriser-enrolement`)).status).toBe(403);
    expect((await api(token).post(`/liste-declarative/agents/${id}/autoriser-enrolement`)).status).toBe(403);
    expect((await dir.post(`/liste-declarative/agents/${id}/autoriser-enrolement`)).status).toBe(200);
    expect(await db('notifications').where({ user_id: (await db('users').where({ username: 'admin' }).first()).id, lien: '/comptes/enrolement' }).first()).toBeTruthy();
    expect((await enroler(token, id, { username: 'odette.lufunda', numero_carte_igap: 'IGAP-STR-001' })).status).toBe(409);
    const r = await enroler(token, id, { username: 'odette.lufunda', numero_carte_igap: 'IGAP-BSD-001' });
    expect(r.status).toBe(201);
    const me = await api(await login('ag.secretariat1')).get('/enrolement/candidats');
    expect(me.body.candidats.some((c) => c.nom === 'LUFUNDA')).toBe(false);
  });

  test('un agent sans affectation reçoit sa structure à l’enrôlement', async () => {
    const token = await login('cb.secretariat');
    const id = await agentId('BOLAMBA');
    const pre = await api(token).get(`/enrolement/agents/${id}`);
    expect(pre.body.affectation).toBeNull();
    expect((await enroler(token, id, { username: 'ruth.bolamba' })).status).toBe(400);
    const bsd = await db('bureaux').where({ code: 'BSD' }).first();
    expect((await enroler(token, id, { username: 'ruth.bolamba', bureau_id: bsd.id })).status).toBe(403);
    const coi = await db('bureaux').where({ code: 'BUR-COI' }).first();
    const r = await enroler(token, id, { username: 'ruth.bolamba', bureau_id: coi.id });
    expect(r.status).toBe(201);
    const aff = await db('affectations').where({ agent_id: id, est_active: true }).first();
    expect(aff).toMatchObject({ niveau: 'BUREAU', bureau_id: coi.id, division_id: coi.division_id });
    // L’affectation choisie à l’enrôlement n’impose pas de revalidation de la liste
    const e = await api(await login('directeur')).get('/liste-declarative');
    expect(e.body.agents.find((x) => x.agent_id === id)).toMatchObject({ valide: true, ecart: null });
  });

  test('toute modification de la liste après validation exige une revalidation', async () => {
    const admin = api(await login('directeur'));
    const grade = await db('grades').where({ code: 'ATA1' }).first();
    const n = await admin.post('/agents', { matricule: 'DEP-0901', nom: 'TESTLISTE', prenom: 'Agent', grade_id: grade.id });
    expect(n.status).toBe(201);
    const dir = api(await login('directeur'));
    let e = await dir.get('/liste-declarative');
    expect(e.body.statut).toBe('A_REVALIDER');
    expect(e.body.ecarts.ajoutes).toBeGreaterThanOrEqual(1);
    const token = await login('cb.secretariat');
    expect((await enroler(token, n.body.id, { username: 'agent.testliste' })).status).toBe(403);
    expect((await dir.post('/liste-declarative/valider', { commentaire: 'Ajout d’un agent' })).status).toBe(201);
    // Modification du grade après validation : de nouveau bloqué
    const g2 = await db('grades').where({ code: 'ATA2' }).first();
    expect((await admin.put(`/agents/${n.body.id}`, { grade_id: g2.id })).status).toBe(200);
    e = await dir.get('/liste-declarative');
    expect(e.body.statut).toBe('A_REVALIDER');
    expect(e.body.agents.find((a) => a.agent_id === n.body.id)).toMatchObject({ ecart: 'MODIFIE', champsModifies: ['grade_id'] });
    const r = await enroler(token, n.body.id, { username: 'agent.testliste' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/revalidée/);
    // Un agent qui a un compte ne peut pas être retiré ; un autre peut l’être
    const masika = await agentId('MASIKA');
    expect((await dir.post(`/liste-declarative/agents/${masika}/retirer`)).status).toBe(400);
    expect((await dir.post(`/liste-declarative/agents/${n.body.id}/retirer`)).status).toBe(200);
    // Historique en ajout seul
    await expect(db('listes_declaratives_validations').update({ nb_agents: 0 })).rejects.toThrow();
    const h = await dir.get('/liste-declarative');
    expect(h.body.historique.length).toBeGreaterThanOrEqual(2);
    expect(h.body.progression.secretariat.total).toBeGreaterThanOrEqual(4);
  });

  test('identification : l’agent est recherché sur la liste avant toute saisie', async () => {
    const token = await login('cb.secretariat');
    const c = api(token);
    expect((await c.get('/enrolement/identifier?q=a')).status).toBe(400);
    // Par matricule, avec ou sans ponctuation
    const m = await db('agents').where({ nom: 'MASIKA' }).first();
    const r1 = await c.get(`/enrolement/identifier?q=${encodeURIComponent(m.matricule.toLowerCase())}`);
    expect(r1.body.resultats).toHaveLength(1);
    expect(r1.body.resultats[0]).toMatchObject({ nom: 'MASIKA', surListe: true, statut: 'COMPTE_EXISTANT' });
    // Par nom sans accents ; un agent hors liste est signalé comme tel
    const n = await api(await login('directeur')).post('/agents', { matricule: 'DEP-0950', nom: 'ÉKOMBÉ', prenom: 'Hors liste' });
    await db('agents').where({ id: n.body.id }).update({ liste_declarative: false });
    const r2 = await c.get('/enrolement/identifier?q=ekombe');
    expect(r2.body.resultats[0]).toMatchObject({ surListe: false, statut: 'NON_INSCRIT' });
    expect(r2.body.resultats[0].motif).toMatch(/ne figure pas sur la liste/);
    // Le Secrétariat voit un agent du Secrétariat comme hors de sa portée
    const bsd = await c.get('/enrolement/identifier?q=kapinga');
    expect(bsd.body.resultats[0].statut).toBe('COMPTE_EXISTANT');
    // Confirmations obligatoires
    const autre = await admin_agent();
    const sans = await enroler(token, autre, { username: 'sans.confirmation', affectation_confirmee: undefined });
    expect(sans.status).toBe(400);
    expect(JSON.stringify(sans.body)).toMatch(/affectation/);
  });

  test('exports de la liste déclarative', async () => {
    const dir = api(await login('directeur'));
    const p = await dir.get('/liste-declarative/export/pdf');
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toMatch(/pdf/);
    // Liste officielle uniquement si validée et inchangée ; sinon, projet
    const statut = (await dir.get('/liste-declarative')).body.statut;
    expect(p.headers['content-disposition']).toMatch(statut === 'VALIDEE' ? /liste-officielle/ : /projet-liste/);
    const x = await dir.get('/liste-declarative/export/xlsx');
    expect(x.status).toBe(200);
  });
});
