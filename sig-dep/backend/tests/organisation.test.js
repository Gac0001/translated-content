'use strict';
/** Gestion des structures par le Directeur : création, postes, rattachement, archivage. */
const { db, login, api, userId, enroler } = require('./helpers');

describe('Gestion des structures', () => {
  let dir;
  beforeAll(async () => { dir = api(await login('directeur')); });

  test('seul le Directeur gère les structures', async () => {
    const cb = api(await login('cb.eap'));
    expect((await cb.post('/organisation/divisions', { code: 'DIV-X', nom: 'Division interdite' })).status).toBe(403);
  });

  test('créer une Division crée aussi le poste de Chef de Division', async () => {
    const r = await dir.post('/organisation/divisions', { code: 'DIV-TN', nom: 'Division de la Transformation Numérique', missions: 'Piloter la transformation numérique.' });
    expect(r.status).toBe(201);
    expect(r.body.rang_organique).toBe('DIVISION');
    const poste = await db('postes_organiques').where({ division_id: r.body.id, role_associe: 'CHEF_DIVISION' }).first();
    expect(poste).toBeTruthy();
    const b = await dir.post('/organisation/bureaux', { code: 'BUR-GOV', nom: 'Bureau E-Gouvernement', rattachement: 'DIVISION', division_id: r.body.id });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ rang_organique: 'BUREAU', parent_type: 'DIVISION', superieur_direct: 'CHEF_DIVISION', division_id: r.body.id });
    expect(await db('postes_organiques').where({ bureau_id: b.body.id })).toHaveLength(2);
  });

  test('un Bureau rattaché à une Division inexistante est refusé', async () => {
    expect((await dir.post('/organisation/bureaux', { code: 'BUR-ZZ', nom: 'Bureau fantôme', rattachement: 'DIVISION', division_id: 9999 })).status).toBe(400);
    expect((await dir.post('/organisation/bureaux', { code: 'BUR-ZY', nom: 'Bureau sans division', rattachement: 'DIVISION' })).status).toBe(400);
  });

  test('un nouveau Bureau rattaché au Directeur reste un Bureau et dépend du Directeur', async () => {
    const b = await dir.post('/organisation/bureaux', { code: 'BUR-CEL', nom: 'Bureau Cellule de Communication', rattachement: 'DIRECTION' });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ rang_organique: 'BUREAU', parent_type: 'DIRECTION', division_id: null, superieur_direct: 'DIRECTEUR', est_secretariat_direction: false });
    // Affecter un Chef de Bureau (nouvel Agent) puis lui créer un compte
    const cb = await db('grades').where({ code: 'CB' }).first();
    const ag = await dir.post('/agents', { matricule: 'DEP-0700', nom: 'LUMBU', prenom: 'Joël', sexe: 'M', grade_id: cb.id });
    const poste = await db('postes_organiques').where({ bureau_id: b.body.id, role_associe: 'CHEF_BUREAU' }).first();
    expect((await dir.post(`/agents/${ag.body.id}/affectations`, { bureau_id: b.body.id, poste_id: poste.id, date_debut: '2026-09-01' })).status).toBe(201);
    // Le Directeur revalide la liste déclarative, puis le Bureau Secrétariat enrôle l’agent (création de son compte)
    expect((await dir.post('/liste-declarative/valider', {})).status).toBe(201);
    const u = await enroler(await login('cb.secretariat'), ag.body.id, { username: 'cb.cellule', sexe: 'M' });
    expect(u.status).toBe(201);
    expect(u.body.role).toBe('CHEF_BUREAU');
    await db('users').where({ id: u.body.id }).update({ must_change_password: false });
    const { request, app } = require('./helpers');
    const l = await request(app).post('/api/auth/login').send({ username: 'cb.cellule', password: u.body.motDePasseTemporaire });
    const cbc = api(l.body.accessToken);
    const me = await cbc.get('/hierarchie/contacts?sens=ASCENDANT');
    expect(me.body.data.map((c) => c.username)).toEqual(['directeur']);
    expect((await cbc.get('/auth/me')).body.user.perimetre).toBe('BUREAU');
    // Le Directeur l’instruit directement ; aucun Chef de Division ne le peut
    expect((await dir.post('/instructions', { destinataire_user_id: u.body.id, objet: 'Plan de communication', contenu: 'Préparer le plan' })).status).toBe(201);
    expect((await api(await login('cd.edi')).post('/instructions', { destinataire_user_id: u.body.id, objet: 'Interdit', contenu: 'Contenu test' })).status).toBe(403);
    // Statistiques : toujours 3 Divisions d’origine + celle créée plus haut, le Bureau compte parmi les Bureaux rattachés au Directeur
    const o = await dir.get('/organisation/organigramme');
    expect(o.body.bureauxRattachesDirection.map((x) => x.code)).toEqual(expect.arrayContaining(['BSD', 'BUR-CEL']));
    expect(o.body.divisions.map((x) => x.code)).not.toContain('BUR-CEL');
  });

  test('le changement de rattachement d’un Bureau est propagé aux affectations en cours', async () => {
    const bur = await db('bureaux').where({ code: 'BUR-DOI' }).first();
    const target = await db('divisions').where({ code: 'DIV-SCI' }).first();
    // Le code organique doit suivre la nouvelle Division (5.3.3.2.N).
    const sansCode = await dir.put(`/organisation/bureaux/${bur.id}`, { code: bur.code, nom: bur.nom, rattachement: 'DIVISION', division_id: target.id });
    expect(sansCode.status).toBe(400);
    expect(sansCode.body.error.message).toMatch(/5\.3\.3\.2\.N/);
    const r = await dir.put(`/organisation/bureaux/${bur.id}`, { code: bur.code, nom: bur.nom, code_organique: '5.3.3.2.3', rattachement: 'DIVISION', division_id: target.id });
    expect(r.status).toBe(200);
    const affs = await db('affectations').where({ bureau_id: bur.id, est_active: true });
    expect(affs.length).toBeGreaterThan(0);
    expect(affs.every((a) => a.division_id === target.id)).toBe(true);
    const contacts = await api(await login('cb.doi')).get('/hierarchie/contacts?sens=ASCENDANT');
    expect(contacts.body.data[0].username).toBe('cd.sci');
    // retour à la situation initiale
    const orig = await db('divisions').where({ code: 'DIV-EDI' }).first();
    expect((await dir.put(`/organisation/bureaux/${bur.id}`, { code: bur.code, nom: bur.nom, code_organique: bur.code_organique, rattachement: 'DIVISION', division_id: orig.id })).status).toBe(200);
    expect((await db('affectations').where({ bureau_id: bur.id, est_active: true }).first()).division_id).toBe(orig.id);
  });

  test('archivage refusé tant que des Agents sont affectés ; poste occupé non désactivable', async () => {
    const bur = await db('bureaux').where({ code: 'BUR-PRG' }).first();
    expect((await dir.post(`/organisation/bureaux/${bur.id}/archiver`)).status).toBe(400);
    const occupe = await db('postes_organiques').where({ code: 'P-CB-BUR-PRG' }).first();
    expect((await dir.post(`/organisation/postes/${occupe.id}/desactiver`)).status).toBe(400);
    const vide = await dir.post('/organisation/bureaux', { code: 'BUR-TMP', nom: 'Bureau temporaire', rattachement: 'DIRECTION' });
    expect((await dir.post(`/organisation/bureaux/${vide.body.id}/archiver`)).body.actif).toBe(false);
    expect((await dir.get('/organisation/organigramme')).body.bureauxRattachesDirection.map((x) => x.code)).not.toContain('BUR-TMP');
  });

  test('le Chef de Division reste supérieur de ses Bureaux (non-régression)', async () => {
    const r = await api(await login('cb.eap')).get('/hierarchie/contacts?sens=ASCENDANT');
    expect(r.body.data[0].username).toBe('cd.edi');
    expect(await userId('cd.edi')).toBeTruthy();
  });
});
