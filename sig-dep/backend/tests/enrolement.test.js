'use strict';
/**
 * Liste déclarative et enrôlement des agents :
 *  - seuls le Directeur et l’Admin valident la liste ;
 *  - l’Admin enrôle tous les agents ; le Bureau Secrétariat de Direction enrôle ceux des autres structures ;
 *  - les autres utilisateurs n’ont ni l’option ni l’accès.
 */
const { db, login, loginAdmin, api, enroler } = require('./helpers');

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
    expect((await api(await loginAdmin()).get('/liste-declarative')).body.actions.valider).toBe(true);
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
      expect((await api(await login(u)).get('/auth/me')).body.user.permissions).toContain('comptes.enroler');
    }
    expect((await api(await loginAdmin()).get('/auth/me')).body.user.permissions).toContain('comptes.enroler');
    for (const u of ['directeur', 'sg', 'cd.sci', 'cb.str', 'ag.eap1']) {
      const c = api(await login(u));
      expect((await c.get('/auth/me')).body.user.permissions).not.toContain('comptes.enroler');
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
    // Commission téléchargeable par l’Admin
    const dl = await api(await loginAdmin()).get(`/agents/${id}/commission`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toMatch(/pdf/);
  });

  test('l’Admin enrôle les agents du Secrétariat ; le numéro IGAP est unique', async () => {
    const token = await loginAdmin();
    const id = await agentId('LUFUNDA');
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
    const admin = api(await loginAdmin());
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

  test('exports de la liste déclarative', async () => {
    const dir = api(await login('directeur'));
    const p = await dir.get('/liste-declarative/export/pdf');
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toMatch(/pdf/);
    const x = await dir.get('/liste-declarative/export/xlsx');
    expect(x.status).toBe(200);
  });
});
