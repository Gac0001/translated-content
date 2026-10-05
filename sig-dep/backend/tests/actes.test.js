'use strict';
/**
 * Lot 5 — Actes administratifs, intérims et désignations ; double authentification du Directeur
 * et du Secrétaire Général ; avis de connexion depuis un nouvel appareil ; sessions personnelles.
 * Les intérims créés ici sont révoqués en fin de fichier pour ne pas influencer les autres tests.
 */
const { db, request, app, login, loginAdmin, api, userId, PDF } = require('./helpers');
const { aujourdhui } = require('../src/services/interims');
const jobs = require('../src/services/jobs');

const jour = aujourdhui();
const decale = (n) => aujourdhui(new Date(Date.now() + n * 86400000));
const agentDe = async (username) => (await db('users').where({ username }).first('agent_id')).agent_id;
const poste = (code) => db('postes_organiques').where({ code }).first();

async function joindre(token, acteId) {
  return request(app).post(`/api/attachments/ACTE/${acteId}`).set('Authorization', `Bearer ${token}`)
    .attach('fichiers', PDF, { filename: 'acte-signe.pdf', contentType: 'application/pdf' });
}

/** Prépare, joint la pièce et soumet un acte ; renvoie l’acte soumis. */
async function preparerEtSoumettre(token, body) {
  const a = api(token);
  const r = await a.post('/actes', { reference: 'Note de service n° T/2026', date_acte: jour, autorite: 'Le Directeur', ...body });
  if (r.status !== 201) throw new Error(`Création : ${r.status} ${JSON.stringify(r.body)}`);
  await joindre(token, r.body.id);
  const s = await a.post(`/actes/${r.body.id}/soumettre`);
  if (s.status !== 200) throw new Error(`Soumission : ${s.status} ${JSON.stringify(s.body)}`);
  return s.body;
}

describe('Actes administratifs, intérims et désignations', () => {
  let secTok; let sec; let dir; let agent;
  beforeAll(async () => {
    secTok = await login('cb.secretariat');
    sec = api(secTok);
    dir = api(await login('directeur'));
    agent = api(await login('ag.eap2'));
  });
  afterAll(async () => {
    // Retour à l’état initial : fin de tous les intérims créés par ce fichier.
    await db('actes_administratifs').where({ type: 'INTERIM', statut: 'VALIDE' }).update({ statut: 'REVOQUE', motif_revocation: 'Fin des tests' });
  });

  test('circuit : préparation, pièce obligatoire, soumission, validation réservée au Directeur', async () => {
    const p = await poste('P-CB-BUR-COI');
    const r = await sec.post('/actes', {
      type: 'INTERIM', reference: 'Note de service n° 014/DEP/2026', date_acte: jour, autorite: 'Le Directeur',
      objet: 'Intérim du Chef du Bureau Coopération Internationale', agent_id: await agentDe('ag.coi1'), poste_id: p.id,
      date_debut: jour, date_fin: decale(20),
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ statut: 'BROUILLON', validation_par: 'DIRECTEUR', numero: expect.stringMatching(/^DEP\/ACT\/\d{4}\/\d{4}$/) });
    // Sans copie de l’acte signé : soumission refusée.
    const sans = await sec.post(`/actes/${r.body.id}/soumettre`);
    expect(sans.status).toBe(400);
    expect(sans.body.error.message).toMatch(/copie scannée/);
    expect((await joindre(secTok, r.body.id)).status).toBe(201);
    expect((await sec.post(`/actes/${r.body.id}/soumettre`)).status).toBe(200);
    // Le Directeur est notifié.
    const notif = await db('notifications').where({ user_id: await userId('directeur'), type: 'ACTE' }).orderBy('id', 'desc').first();
    expect(notif.titre).toMatch(/Acte à valider/);
    // Pièce figée après soumission ; un Agent ne valide pas.
    expect((await joindre(secTok, r.body.id)).status).toBe(403);
    expect((await agent.post(`/actes/${r.body.id}/decision`, { decision: 'VALIDE' })).status).toBe(403);
    // Validation par le Directeur.
    const v = await dir.post(`/actes/${r.body.id}/decision`, { decision: 'VALIDE', commentaire: 'Vu' });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ statut: 'VALIDE', effet: 'EN_VIGUEUR', titulaire: expect.any(String) });
    const hist = (await dir.get(`/actes/${r.body.id}`)).body.historique.map((h) => h.action);
    expect(hist).toEqual(['PREPARATION', 'SOUMISSION', 'VALIDATION']);
  });

  test('intérim en vigueur : rôle et périmètre du poste pour l’intérimaire, titulaire suspendu', async () => {
    const coi = await db('bureaux').where({ code: 'BUR-COI' }).first();
    const me = (await api(await login('ag.coi1')).get('/auth/me')).body.user;
    expect(me.primaryRole).toBe('CHEF_BUREAU');
    expect(me.perimetre).toBe('BUREAU');
    expect(me.interim).toMatchObject({ role: 'CHEF_BUREAU', dateFin: decale(20) });
    expect(me.affectation).toMatchObject({ bureauId: coi.id, interim: true });
    expect(me.permissions).toContain('taches.attribuer');
    const titulaire = (await api(await login('cb.coi')).get('/auth/me')).body.user;
    expect(titulaire.primaryRole).toBe('AGENT');
    expect(titulaire.permissions).not.toContain('taches.attribuer');
    expect(titulaire.suspensions[0]).toMatchObject({ interimaire: expect.stringMatching(/\S/) });
    // Chaîne hiérarchique : l’intérimaire rend compte au Chef de Division.
    const contacts = await api(await login('ag.coi1')).get('/hierarchie/contacts?sens=ASCENDANT');
    expect(contacts.body.data.map((c) => c.username)).toEqual(['cd.sci']);
    // Organigramme : l’intérim est affiché à côté du titulaire.
    const o = (await dir.get('/organisation/organigramme')).body;
    const b = o.divisions.flatMap((d) => d.bureaux).find((x) => x.code === 'BUR-COI');
    expect(b.interim).toMatchObject({ titre: 'Chef de Bureau ad intérim', dateFin: decale(20) });
    expect(b.responsable).toBeTruthy();
    expect((await dir.get('/actes/interims')).body.data.some((i) => i.posteId === b.id || i.poste.includes('Coopération'))).toBe(true);
  });

  test('un seul intérim par poste ; acte décidé intangible (contrôlé en base)', async () => {
    const p = await poste('P-CB-BUR-COI');
    const r = await sec.post('/actes', {
      type: 'INTERIM', reference: 'Note concurrente', date_acte: jour, autorite: 'Le Directeur', objet: 'Second intérim concurrent',
      agent_id: await agentDe('ag.eap2'), poste_id: p.id, date_debut: decale(5), date_fin: decale(30),
    });
    await joindre(secTok, r.body.id);
    const s = await sec.post(`/actes/${r.body.id}/soumettre`);
    expect(s.status).toBe(409);
    expect(s.body.error.code).toBe('INTERIM_CONCURRENT');
    await sec.del(`/actes/${r.body.id}`);
    const valide = await db('actes_administratifs').where({ type: 'INTERIM', statut: 'VALIDE', poste_id: p.id }).first();
    await expect(db('actes_administratifs').where({ id: valide.id }).update({ date_fin: decale(90) })).rejects.toThrow(/ACTE_INTANGIBLE/);
    await expect(db('actes_administratifs').where({ id: valide.id }).del()).rejects.toThrow(/ACTE_INTANGIBLE/);
    await expect(db('actes_administratifs').where({ id: valide.id }).update({ statut: 'BROUILLON' })).rejects.toThrow(/ACTE_INTANGIBLE/);
  });

  test('rectificatif : remplace l’acte d’origine à sa validation', async () => {
    const orig = await db('actes_administratifs').where({ type: 'INTERIM', statut: 'VALIDE', poste_id: (await poste('P-CB-BUR-COI')).id }).first();
    const r = await sec.post(`/actes/${orig.id}/rectifier`);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ statut: 'BROUILLON', rectifie_acte_id: orig.id });
    expect((await sec.post(`/actes/${orig.id}/rectifier`)).status).toBe(409); // un seul rectificatif en cours
    expect((await sec.put(`/actes/${r.body.id}`, { date_fin: decale(10), reference: 'Note rectificative n° 014 bis' })).status).toBe(200);
    await joindre(secTok, r.body.id);
    expect((await sec.post(`/actes/${r.body.id}/soumettre`)).status).toBe(200);
    const v = await dir.post(`/actes/${r.body.id}/decision`, { decision: 'VALIDE' });
    expect(v.status).toBe(200);
    expect((await db('actes_administratifs').where({ id: orig.id }).first()).statut).toBe('REMPLACE');
    expect((await api(await login('ag.coi1')).get('/auth/me')).body.user.interim.dateFin).toBe(decale(10));
  });

  test('révocation : les droits cessent immédiatement, le titulaire retrouve son rôle', async () => {
    const a = await db('actes_administratifs').where({ type: 'INTERIM', statut: 'VALIDE', poste_id: (await poste('P-CB-BUR-COI')).id }).first();
    expect((await dir.post(`/actes/${a.id}/revoquer`, { motif: 'x' })).status).toBe(400);
    expect((await sec.post(`/actes/${a.id}/revoquer`, { motif: 'Retour anticipé du titulaire' })).status).toBe(403);
    const r = await dir.post(`/actes/${a.id}/revoquer`, { motif: 'Retour anticipé du titulaire' });
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('REVOQUE');
    expect((await api(await login('ag.coi1')).get('/auth/me')).body.user).toMatchObject({ primaryRole: 'AGENT', interim: null });
    expect((await api(await login('cb.coi')).get('/auth/me')).body.user).toMatchObject({ primaryRole: 'CHEF_BUREAU', suspensions: [] });
  });

  test('poste de Directeur : enregistré par l’Admin, validé par le Secrétaire Général', async () => {
    const p = await poste('P-DIR');
    const body = {
      type: 'INTERIM', reference: 'Décision n° 007/SG/2026', date_acte: jour, autorite: 'Le Secrétaire Général',
      objet: 'Intérim du Directeur pendant sa mission', agent_id: await agentDe('cd.edi'), poste_id: p.id, date_debut: jour, date_fin: decale(7),
    };
    const refus = await sec.post('/actes', body);
    expect(refus.status).toBe(403);
    expect(refus.body.error.code).toBe('PREPARATION_NON_AUTORISEE');
    const adminTok = await loginAdmin();
    const acte = await preparerEtSoumettre(adminTok, body);
    expect(acte.validation_par).toBe('SECRETAIRE_GENERAL');
    // Le Directeur, titulaire concerné, ne valide pas ; le SG valide.
    expect((await dir.post(`/actes/${acte.id}/decision`, { decision: 'VALIDE' })).status).toBe(403);
    const sg = api(await login('sg'));
    expect((await sg.post(`/actes/${acte.id}/decision`, { decision: 'VALIDE' })).status).toBe(200);
    // L’intérimaire exerce comme Directeur : périmètre de la Direction et exigences renforcées (double authentification).
    const r = await request(app).post('/api/auth/login').send({ username: 'cd.edi', password: 'Demo@2026' });
    expect(r.body.user.exigences).toContain('DEUX_FACTEURS');
    const me = (await api(await login('cd.edi')).get('/auth/me')).body.user;
    expect(me).toMatchObject({ primaryRole: 'DIRECTEUR', perimetre: 'DIRECTION' });
    expect((await api(await login('directeur')).get('/auth/me')).body.user.primaryRole).not.toBe('DIRECTEUR');
    // Les avis destinés au Directeur vont à l’intérimaire.
    const { directeursActifs } = require('../src/services/alertes');
    expect(await directeursActifs()).toEqual([await userId('cd.edi')]);
    // Fin de l’intérim par le SG.
    expect((await sg.post(`/actes/${acte.id}/revoquer`, { motif: 'Retour du Directeur' })).status).toBe(200);
    expect((await api(await login('directeur')).get('/auth/me')).body.user.primaryRole).toBe('DIRECTEUR');
    expect((await api(await login('cd.edi')).get('/auth/me')).body.user.primaryRole).toBe('CHEF_DIVISION');
  });

  test('désignation : droits bornés à la période, puis expiration par la tâche quotidienne', async () => {
    const ben = await agentDe('ag.secretariat2');
    const enCours = await preparerEtSoumettre(secTok, {
      type: 'DESIGNATION', objet: 'Désignation pour l’enregistrement du courrier', agent_id: ben,
      permissions: ['courriers.enregistrer'], date_debut: jour, date_fin: decale(15),
    });
    expect((await dir.post(`/actes/${enCours.id}/decision`, { decision: 'VALIDE' })).status).toBe(200);
    const me = (await api(await login('ag.secretariat2')).get('/auth/me')).body.user;
    expect(me.permissions).toContain('courriers.enregistrer');
    expect(me.designations).toContain('courriers.enregistrer');
    const liste = (await dir.get('/users/designations')).body.data.filter((d) => d.acte_id === enCours.id);
    expect(liste).toEqual([expect.objectContaining({ code: 'courriers.enregistrer', etat: 'EN_VIGUEUR', acte_numero: enCours.numero })]);

    // Désignation échue : aucun droit, puis passage à l’état « expiré » par la tâche planifiée.
    const echue = await preparerEtSoumettre(secTok, {
      type: 'DESIGNATION', objet: 'Désignation échue (régularisation)', agent_id: ben,
      permissions: ['presences.preparer_direction'], date_debut: decale(-10), date_fin: decale(-1),
    });
    const v = await dir.post(`/actes/${echue.id}/decision`, { decision: 'VALIDE' });
    expect(v.body.effet).toBe('ECHU');
    expect((await api(await login('ag.secretariat2')).get('/auth/me')).body.user.permissions).not.toContain('presences.preparer_direction');
    await jobs.echeancesActes();
    expect((await db('actes_administratifs').where({ id: echue.id }).first()).statut).toBe('EXPIRE');
    expect((await db('user_permissions').where({ acte_id: echue.id }).first()).revoked_at).not.toBeNull();
    expect((await db('actes_administratifs').where({ id: enCours.id }).first()).statut).toBe('VALIDE');
    await dir.post(`/actes/${enCours.id}/revoquer`, { motif: 'Fin de la désignation de test' });
  });

  test('droits accordés sans acte : à régulariser, retirés à l’échéance', async () => {
    const u = await userId('ag.secretariat1');
    const perm = await db('permissions').where({ code: 'dossiers.transmettre' }).first();
    const [row] = await db('user_permissions').insert({ user_id: u, permission_id: perm.id, motif: 'Ancienne délégation', a_regulariser_avant: db.raw(`now() + interval '30 days'`) }).returning('*');
    expect((await api(await login('ag.secretariat1')).get('/auth/me')).body.user.permissions).toContain('dossiers.transmettre');
    expect((await dir.get('/users/designations')).body.data.find((d) => d.id === row.id).etat).toBe('A_REGULARISER');
    await db('user_permissions').where({ id: row.id }).update({ a_regulariser_avant: db.raw(`now() - interval '1 minute'`) });
    expect((await api(await login('ag.secretariat1')).get('/auth/me')).body.user.permissions).not.toContain('dossiers.transmettre');
    await jobs.echeancesActes();
    expect((await db('user_permissions').where({ id: row.id }).first()).motif_revocation).toMatch(/Non régularisée/);
  });

  test('rôles d’autorité : attribution ou retrait sur acte validé uniquement', async () => {
    const admin = api(await loginAdmin());
    const cible = await userId('cb.doi');
    const sans = await admin.put(`/users/${cible}/roles`, { roles: ['CHEF_DIVISION'] });
    expect(sans.status).toBe(403);
    expect(sans.body.error.code).toBe('DECISION_ADMINISTRATIVE_REQUISE');
    const nomination = await preparerEtSoumettre(secTok, { type: 'NOMINATION', objet: 'Nomination de test', agent_id: await agentDe('cb.doi') });
    await dir.post(`/actes/${nomination.id}/decision`, { decision: 'VALIDE' });
    // L’acte lève l’exigence de décision ; la cohérence avec l’affectation reste contrôlée.
    const avec = await admin.put(`/users/${cible}/roles`, { roles: ['CHEF_DIVISION'], acte_id: nomination.id });
    expect(avec.status).toBe(400);
    expect(avec.body.error.message).toMatch(/affectation au niveau d’une Division/);
    // Un acte concernant une autre personne ne vaut pas.
    const autre = await admin.put(`/users/${await userId('cb.str')}/roles`, { roles: ['CHEF_DIVISION'], acte_id: nomination.id });
    expect(autre.status).toBe(403);
  });

  test('registre : visibilité selon le rôle', async () => {
    const tous = (await dir.get('/actes')).body;
    expect(tous.droits).toMatchObject({ registre: true, valider: true });
    expect(tous.data.length).toBeGreaterThan(3);
    const admin = (await api(await loginAdmin()).get('/actes')).body.data;
    expect(admin.every((a) => a.validation_par === 'SECRETAIRE_GENERAL')).toBe(true);
    // Un Agent ne voit que les actes validés qui le concernent.
    const concerne = (await api(await login('ag.coi1')).get('/actes')).body.data;
    expect(concerne.length).toBeGreaterThan(0);
    expect(concerne.every((a) => a.personne && ['VALIDE', 'REVOQUE', 'EXPIRE', 'REMPLACE'].includes(a.statut))).toBe(true);
    expect((await agent.get('/actes/referentiels')).status).toBe(403);
  });
});

describe('Sécurité du Directeur et du Secrétaire Général', () => {
  test('double authentification active après la première configuration', async () => {
    await login('sg');
    const u = await db('users').where({ username: 'sg' }).first();
    expect(u.totp_actif).toBe(true);
    const r = await request(app).post('/api/auth/login').send({ username: 'sg', password: 'Demo@2026' });
    expect(r.body).toMatchObject({ deuxFacteurs: true });
  });

  test('avis de connexion depuis un nouvel appareil et fermeture de session à distance', async () => {
    const { connexion, codeTotp } = require('./helpers');
    await login('directeur');
    const avant = Number((await db('notifications').where({ user_id: await userId('directeur'), type: 'CONNEXION' }).count('* as n').first()).n);
    const r1 = await request(app).post('/api/auth/login').set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Firefox/131.0').send({ username: 'directeur', password: 'Demo@2026' });
    const r2 = await request(app).post('/api/auth/login/deux-facteurs').set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Firefox/131.0').send({ defi: r1.body.defi, code: await codeTotp('directeur') });
    expect(r2.status).toBe(200);
    const notes = await db('notifications').where({ user_id: await userId('directeur'), type: 'CONNEXION' }).orderBy('id', 'desc');
    expect(notes.length).toBe(avant + 1);
    expect(notes[0].message).toMatch(/Firefox sur Windows/);
    // Même appareil : pas de nouvel avis.
    await connexion('directeur', 'Demo@2026');
    await connexion('directeur', 'Demo@2026');
    const apres = Number((await db('notifications').where({ user_id: await userId('directeur'), type: 'CONNEXION' }).count('* as n').first()).n);
    expect(apres).toBe(avant + 1);

    // Sessions : liste, puis fermeture de la session ouverte sous Firefox depuis une autre session.
    const tok = await login('directeur');
    const s = await api(tok).get('/auth/sessions');
    const firefox = s.body.data.find((x) => /Firefox/.test(x.appareil));
    expect(firefox).toBeTruthy();
    const f = await api(tok).post(`/auth/sessions/${firefox.id}/fermer`);
    expect(f.status).toBe(200);
    expect((await api(r2.body.accessToken).get('/auth/me')).status).toBe(401);
    expect((await api(f.body.accessToken).get('/auth/me')).status).toBe(200);
    expect((await api(f.body.accessToken).get('/auth/sessions')).body.data.some((x) => x.id === firefox.id)).toBe(false);
  });
});
