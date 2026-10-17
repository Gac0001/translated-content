'use strict';
/**
 * Lot C (1.40.0) — Grades du cahier des charges, élévation en grade, nomination, affectation et fin
 * de fonction avec effets, unicité du titulaire, carrière de l’agent, promus en attente de poste,
 * double authentification du Chef du Secrétariat de Direction. Un Bureau de test est créé pour
 * disposer d’un poste de commandement vacant sans toucher aux comptes des autres tests.
 */
const bcrypt = require('bcrypt');
const { db, request, app, login, api, PDF, DEMO } = require('./helpers');
const { aujourdhui } = require('../src/services/interims');
const actes = require('../src/services/actes');
const { calculerExigences } = require('../src/services/context');

const jour = aujourdhui();
const decale = (n) => aujourdhui(new Date(Date.now() + n * 86400000));
const grade = (code) => db('grades').where({ code }).first();

async function preparerEtSoumettre(token, body) {
  const a = api(token);
  const r = await a.post('/actes', { reference: `Décision n° ${Math.floor(Math.random() * 9000) + 1000}/T`, date_acte: jour, autorite: 'Le Directeur', ...body });
  if (r.status !== 201) throw new Error(`Création : ${r.status} ${JSON.stringify(r.body)}`);
  await request(app).post(`/api/attachments/ACTE/${r.body.id}`).set('Authorization', `Bearer ${token}`).attach('fichiers', PDF, { filename: 'acte.pdf', contentType: 'application/pdf' });
  return api(token).post(`/actes/${r.body.id}/soumettre`);
}

describe('Carrière : grades, élévation, nomination, affectation, fin de fonction', () => {
  let secTok; let dir; let bureau; let posteCb; let posteAg; let agentId; let userId;

  beforeAll(async () => {
    secTok = await login('cb.secretariat');
    dir = api(await login('directeur'));
    const div = await db('divisions').where({ code: 'DIV-PS' }).first();
    const b = await dir.post('/organisation/bureaux', { code: 'BUR-CAR', nom: 'Bureau Carrière (test)', code_organique: `${div.code_organique}.8`, rattachement: 'DIVISION', division_id: div.id });
    if (b.status !== 201) throw new Error(`Bureau : ${b.status} ${JSON.stringify(b.body)}`);
    bureau = b.body;
    posteCb = await db('postes_organiques').where({ bureau_id: bureau.id, role_associe: 'CHEF_BUREAU' }).first();
    posteAg = await db('postes_organiques').where({ bureau_id: bureau.id, role_associe: 'AGENT' }).first();
    const ata1 = await grade('ATA1');
    const ag = await dir.post('/agents', { matricule: 'DEP-CAR-01', nom: 'KABONGO', prenom: 'Test', grade_id: ata1.id });
    if (ag.status !== 201) throw new Error(`Agent : ${ag.status} ${JSON.stringify(ag.body)}`);
    agentId = ag.body.id;
    const [u] = await db('users').insert({ username: 'ag.carriere', password_hash: await bcrypt.hash(DEMO, 4), agent_id: agentId, statut: 'ACTIF', must_change_password: false }).returning('id');
    userId = u.id;
    const role = await db('roles').where({ code: 'AGENT' }).first();
    await db('user_roles').insert({ user_id: userId, role_id: role.id });
  });

  test('référentiel des grades au format du cahier (codes 110 à 340, Huissier)', async () => {
    const g = await db('grades').orderBy('niveau', 'desc').select('code_officiel', 'abreviation', 'categorie');
    expect(g.map((x) => x.code_officiel)).toEqual(['110', '120', '130', '140', '210', '220', '310', '320', '330', '340', 'HUI']);
    expect(g.find((x) => x.code_officiel === '140').categorie).toBe('Commandement');
    expect(g.find((x) => x.code_officiel === '220')).toMatchObject({ abreviation: 'ATA 2', categorie: 'Collaboration' });
    expect(g.find((x) => x.code_officiel === 'HUI').categorie).toBe('Huissier');
    // L’enregistrement de l’agent inscrit son grade à l’historique
    expect(await db('agent_grades').where({ agent_id: agentId }).first()).toMatchObject({ motif: 'Grade à l’enregistrement' });
    await expect(db('agent_grades').where({ agent_id: agentId }).del()).rejects.toThrow(/ajout seul/);
  });

  test('affectation par acte sur un poste d’exécution', async () => {
    const nom = await preparerEtSoumettre(secTok, { type: 'NOMINATION', objet: 'Nomination sans le grade requis', agent_id: agentId, poste_id: posteCb.id, date_debut: jour });
    expect(nom.status).toBe(400);
    expect(nom.body.error.message).toMatch(/grade 140 — Chef de Bureau/);
    const s = await preparerEtSoumettre(secTok, { type: 'AFFECTATION', objet: 'Affectation au Bureau Carrière', agent_id: agentId, poste_id: posteAg.id, date_debut: jour });
    expect(s.status).toBe(200);
    const v = await dir.post(`/actes/${s.body.id}/decision`, { decision: 'VALIDE' });
    expect(v.status).toBe(200);
    expect(v.body.effet).toBe('APPLIQUE');
    const aff = await db('affectations').where({ agent_id: agentId, est_active: true }).first();
    expect(aff).toMatchObject({ bureau_id: bureau.id, poste_id: posteAg.id, acte_id: s.body.id });
  });

  test('élévation en grade : nouveau grade, historique, fonction et rôle inchangés, promu en attente', async () => {
    const cb = await grade('CB');
    const inf = await preparerEtSoumettre(secTok, { type: 'ELEVATION_GRADE', objet: 'Rétrogradation impossible', agent_id: agentId, grade_id: (await grade('ATA2')).id, date_debut: jour });
    expect(inf.status).toBe(400);
    const s = await preparerEtSoumettre(secTok, { type: 'ELEVATION_GRADE', objet: 'Élévation au grade de Chef de Bureau', agent_id: agentId, grade_id: cb.id, date_debut: jour });
    expect(s.status).toBe(200);
    const v = await dir.post(`/actes/${s.body.id}/decision`, { decision: 'VALIDE' });
    expect(v.body).toMatchObject({ effet: 'APPLIQUE', effet_detail: expect.stringMatching(/210 — .* → 140 — Chef de Bureau/) });
    expect((await db('agents').where({ id: agentId }).first()).grade_id).toBe(cb.id);
    const h = await db('agent_grades').where({ agent_id: agentId, acte_id: s.body.id }).first();
    expect(h).toMatchObject({ grade_id: cb.id, motif: 'Élévation en grade' });
    const roles = await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', userId).pluck('r.code');
    expect(roles).toEqual(['AGENT']);
    const tdb = (await dir.get('/dashboard')).body;
    expect(tdb.promusEnAttente.map((p) => p.id)).toContain(agentId);
    // Carrière : élévation liée à son acte
    const fiche = (await dir.get(`/agents/${agentId}`)).body;
    expect(fiche.carriere.find((e) => e.type === 'GRADE' && e.acte_id === s.body.id).titre).toMatch(/^Grade 140/);
  });

  test('nomination : poste vacant, intérim clôturé, affectation, fonction et rôle du poste', async () => {
    // Un intérim est en cours sur le poste vacant (intérimaire d’un grade inférieur)
    const ag2 = await dir.post('/agents', { matricule: 'DEP-CAR-02', nom: 'MUTOMBO', prenom: 'Intérim', grade_id: (await grade('ATA2')).id });
    const [u2] = await db('users').insert({ username: 'ag.carriere2', password_hash: await bcrypt.hash(DEMO, 4), agent_id: ag2.body.id, statut: 'ACTIF', must_change_password: false }).returning('id');
    await db('user_roles').insert({ user_id: u2.id, role_id: (await db('roles').where({ code: 'AGENT' }).first()).id });
    const i = await preparerEtSoumettre(secTok, { type: 'INTERIM', objet: 'Intérim du Chef du Bureau Carrière', agent_id: ag2.body.id, poste_id: posteCb.id, date_debut: jour, date_fin: decale(30) });
    expect(i.status).toBe(200);
    expect((await dir.post(`/actes/${i.body.id}/decision`, { decision: 'VALIDE' })).status).toBe(200);
    // Un intérimaire ayant le grade requis : c’est une nomination, pas un intérim
    const mauvais = await preparerEtSoumettre(secTok, { type: 'INTERIM', objet: 'Intérim par un Chef de Bureau', agent_id: agentId, poste_id: posteCb.id, date_debut: decale(40), date_fin: decale(50) });
    expect(mauvais.status).toBe(400);
    expect(mauvais.body.error.message).toMatch(/nomination/);

    const s = await preparerEtSoumettre(secTok, { type: 'NOMINATION', objet: 'Nomination du Chef du Bureau Carrière', agent_id: agentId, poste_id: posteCb.id, date_debut: jour });
    expect(s.status).toBe(200);
    const v = await dir.post(`/actes/${s.body.id}/decision`, { decision: 'VALIDE' });
    expect(v.status).toBe(200);
    expect(v.body.effet_detail).toMatch(/Titulaire du poste .* intérim .* clôturé/);
    expect((await db('actes_administratifs').where({ id: i.body.id }).first()).statut).toBe('EXPIRE');
    expect(await db('affectations').where({ agent_id: agentId, est_active: true }).first()).toMatchObject({ poste_id: posteCb.id, acte_id: s.body.id });
    const roles = await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', userId).pluck('r.code');
    expect(roles).toEqual(['CHEF_BUREAU']);
    expect((await db('agents as a').join('fonctions as f', 'f.id', 'a.fonction_id').where('a.id', agentId).first('f.code')).code).toBe('F-CB');
    // Le Directeur et le nouveau supérieur (Chef de la Division) sont notifiés
    const cdPs = await db('users').where({ username: 'cd.ps' }).first();
    expect(await db('notifications').where({ user_id: cdPs.id, type: 'ACTE' }).where('titre', 'like', '%Nomination du Chef du Bureau Carrière%').first()).toBeDefined();
    expect((await dir.get('/dashboard')).body.promusEnAttente.map((p) => p.id)).not.toContain(agentId);
    // Un acte appliqué ne se révoque pas
    expect((await dir.post(`/actes/${s.body.id}/revoquer`, { motif: 'Erreur matérielle' })).status).toBe(400);
    // Second titulaire refusé (acte et base)
    const second = await preparerEtSoumettre(secTok, { type: 'NOMINATION', objet: 'Second titulaire', agent_id: ag2.body.id, poste_id: posteCb.id, date_debut: jour });
    expect(second.status).toBe(409);
    await expect(db('affectations').insert({ agent_id: ag2.body.id, direction_id: 1, bureau_id: bureau.id, poste_id: posteCb.id, niveau: 'BUREAU', date_debut: jour, est_active: true })).rejects.toThrow(/TITULAIRE_UNIQUE/);
  });

  test('fin de fonction à date future : effet le jour venu, puis promu en attente de poste', async () => {
    const s = await preparerEtSoumettre(secTok, { type: 'FIN_FONCTION', objet: 'Fin de fonction du Chef du Bureau Carrière', agent_id: agentId, poste_id: posteCb.id, date_debut: decale(2) });
    expect(s.status).toBe(200);
    const v = await dir.post(`/actes/${s.body.id}/decision`, { decision: 'VALIDE' });
    expect(v.body.effet).toBe('A_VENIR');
    expect(await db('affectations').where({ agent_id: agentId, est_active: true }).first()).toMatchObject({ poste_id: posteCb.id });
    // Le jour venu (date d’effet ramenée à aujourd’hui pour le test) : la tâche quotidienne applique l’acte
    await db.raw('ALTER TABLE actes_administratifs DISABLE TRIGGER trg_actes_controle');
    await db('actes_administratifs').where({ id: s.body.id }).update({ date_debut: jour });
    await db.raw('ALTER TABLE actes_administratifs ENABLE TRIGGER trg_actes_controle');
    await actes.tacheQuotidienne();
    const a = await db('actes_administratifs').where({ id: s.body.id }).first();
    expect(a.effet_applique_at).not.toBeNull();
    expect(await db('affectations').where({ agent_id: agentId, est_active: true }).first()).toMatchObject({ bureau_id: bureau.id, poste_id: posteAg.id });
    const roles = await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', userId).pluck('r.code');
    expect(roles).toEqual(['AGENT']);
    expect((await dir.get('/dashboard')).body.promusEnAttente.map((p) => p.id)).toContain(agentId);
    // Carrière complète, la plus récente d’abord
    const types = (await dir.get(`/agents/${agentId}`)).body.carriere.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['AFFECTATION', 'GRADE', 'FIN_FONCTION']));
  });

  test('double authentification obligatoire pour le Chef du Secrétariat de Direction', async () => {
    const user = { must_change_password: false, totp_actif: false, email_recuperation: null, regles_acceptees_version: 0 };
    const pol = { mdp_expiration_jours: 0, regles_securite_version: 1 };
    expect(calculerExigences(user, ['CHEF_BUREAU'], pol).exigences).not.toContain('DEUX_FACTEURS');
    expect(calculerExigences(user, ['CHEF_BUREAU'], pol, { chefSecretariat: true }).exigences).toContain('DEUX_FACTEURS');
    // Le compte de test du Chef du Secrétariat se connecte en deux étapes
    const r = await request(app).post('/api/auth/login').send({ username: 'cb.secretariat', password: DEMO });
    expect(r.body.deuxFacteurs).toBe(true);
  });
});
