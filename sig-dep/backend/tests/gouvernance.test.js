'use strict';
/**
 * Lot 6 — Gouvernance du compte Admin Système : double confirmation des opérations critiques,
 * accès de support temporaire, compte d’urgence scellé.
 */
const { db, request, app, login, loginAdmin, api, userId, PDF, DEMO, ADMIN_NEW } = require('./helpers');
const jobs = require('../src/services/jobs');

describe('Double confirmation des opérations critiques', () => {
  let admin; let dir;
  beforeAll(async () => { admin = api(await loginAdmin()); dir = api(await login('directeur')); });

  test('demande, refus motivé, confirmation, exécution unique', async () => {
    const valeur = (await admin.get('/securite/politique')).body.valeurs.alerte_echecs_seuil;
    const corps = { alerte_echecs_seuil: valeur === 9 ? 8 : 9 };
    const a = await admin.put('/securite/politique', corps);
    expect(a.status).toBe(202);
    expect(a.body.demande).toMatchObject({ type: 'POLITIQUE', statut: 'EN_ATTENTE', resume: expect.stringMatching(/→/) });
    // Même opération relancée : pas de doublon.
    expect((await admin.put('/securite/politique', corps)).body.demande.id).toBe(a.body.demande.id);
    expect((await admin.get('/securite/politique')).body.valeurs.alerte_echecs_seuil).toBe(valeur);
    // Le Directeur est notifié ; l’Admin ne peut pas confirmer.
    expect(await db('notifications').where({ user_id: await userId('directeur'), lien: '/gouvernance' }).first()).toBeTruthy();
    expect((await admin.post(`/gouvernance/confirmations/${a.body.demande.id}/decision`, { decision: 'CONFIRMER', motDePasse: ADMIN_NEW })).status).toBe(403);
    // Refus : mot de passe vérifié, motif exigé.
    expect((await dir.post(`/gouvernance/confirmations/${a.body.demande.id}/decision`, { decision: 'REFUSER', motDePasse: 'faux', commentaire: 'Pas maintenant' })).status).toBe(400);
    expect((await dir.post(`/gouvernance/confirmations/${a.body.demande.id}/decision`, { decision: 'REFUSER', motDePasse: DEMO })).status).toBe(400);
    expect((await dir.post(`/gouvernance/confirmations/${a.body.demande.id}/decision`, { decision: 'REFUSER', motDePasse: DEMO, commentaire: 'Pas pendant la clôture' })).status).toBe(200);
    // Nouvelle demande, confirmée cette fois.
    const b = await admin.put('/securite/politique', corps);
    expect(b.status).toBe(202);
    expect(b.body.demande.id).not.toBe(a.body.demande.id);
    expect((await dir.get('/gouvernance/confirmations')).body.data.find((d) => d.id === b.body.demande.id).typeLibelle).toMatch(/politique/);
    expect((await dir.post(`/gouvernance/confirmations/${b.body.demande.id}/decision`, { decision: 'CONFIRMER', motDePasse: DEMO })).status).toBe(200);
    // D’autres paramètres que ceux confirmés : nouvelle demande, rien n’est appliqué.
    expect((await admin.put('/securite/politique', { alerte_echecs_seuil: 15 })).status).toBe(202);
    const c = await admin.put('/securite/politique', corps);
    expect(c.status).toBe(200);
    expect((await admin.get('/securite/politique')).body.valeurs.alerte_echecs_seuil).toBe(corps.alerte_echecs_seuil);
    expect((await db('demandes_confirmation').where({ id: b.body.demande.id }).first()).statut).toBe('EXECUTEE');
    expect(await db('audit_logs').where({ action: 'CONFIRMATION_OPERATION', entite_id: String(b.body.demande.id) }).first()).toBeTruthy();
    // L’Admin ne voit que ses demandes ; il peut annuler celle restée en attente.
    const miennes = (await admin.get('/gouvernance/confirmations')).body.data;
    const enAttente = miennes.find((d) => d.statut === 'EN_ATTENTE');
    expect((await admin.post(`/gouvernance/confirmations/${enAttente.id}/annuler`)).status).toBe(200);
  });

  test('une confirmation non utilisée expire', async () => {
    const a = await admin.put('/securite/politique', { alerte_echecs_seuil: 14 });
    await dir.post(`/gouvernance/confirmations/${a.body.demande.id}/decision`, { decision: 'CONFIRMER', motDePasse: DEMO });
    await db('demandes_confirmation').where({ id: a.body.demande.id }).update({ expire_at: db.raw(`now() - interval '1 minute'`) });
    const r = await admin.put('/securite/politique', { alerte_echecs_seuil: 14 });
    expect(r.status).toBe(202);
    expect((await db('demandes_confirmation').where({ id: a.body.demande.id }).first()).statut).toBe('EXPIREE');
    await admin.post(`/gouvernance/confirmations/${r.body.demande.id}/annuler`);
  });

  test('le Directeur ne peut pas lancer une opération critique de l’Admin', async () => {
    expect((await dir.put('/securite/politique', { alerte_echecs_seuil: 7 })).status).toBe(403);
    expect((await dir.post('/systeme/reinitialisation', { mode: 'DEMO', confirmation: 'REINITIALISER', motDePasse: DEMO })).status).toBe(403);
  });
});

describe('Accès de support temporaire', () => {
  let admin; let dir; let courrier; let autre; let piece;
  beforeAll(async () => {
    admin = api(await loginAdmin());
    dir = api(await login('directeur'));
    const rows = await db('courriers as c').join('users as u', 'u.id', 'c.created_by').where('c.confidentialite', 'ORDINAIRE').orderBy('c.id').limit(2).select('c.id', 'u.username');
    [courrier, autre] = rows;
    const tok = await login(courrier.username);
    const up = await request(app).post(`/api/attachments/COURRIER/${courrier.id}`).set('Authorization', `Bearer ${tok}`).attach('fichiers', PDF, { filename: 'piece-support.pdf', contentType: 'application/pdf' });
    piece = up.body.data[0];
  });

  test('téléchargement d’une pièce jointe par une personne du périmètre (non-régression)', async () => {
    const r = await api(await login(courrier.username)).get(`/attachments/fichier/${piece.id}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('sans accès validé, l’Admin ne lit aucune pièce jointe', async () => {
    expect((await admin.get(`/attachments/COURRIER/${courrier.id}`)).status).toBe(403);
    expect((await admin.get(`/attachments/fichier/${piece.id}`)).status).toBe(403);
  });

  test('demande, validation par le Directeur, consultation auditée, limites, fin', async () => {
    expect((await admin.post('/gouvernance/support', { motif: 'court', duree_minutes: 30 })).status).toBe(400);
    expect((await admin.post('/gouvernance/support', { motif: 'Pièce illisible signalée par le Secrétariat', entity_type: 'COURRIER', entity_id: courrier.id, duree_minutes: 300 })).status).toBe(400);
    const d = await admin.post('/gouvernance/support', { motif: 'Pièce illisible signalée par le Secrétariat', entity_type: 'COURRIER', entity_id: courrier.id, duree_minutes: 30 });
    expect(d.status).toBe(201);
    expect((await admin.post('/gouvernance/support', { motif: 'Seconde demande simultanée', duree_minutes: 30 })).status).toBe(409);
    // Pas d’accès tant que le Directeur n’a pas validé.
    expect((await admin.get(`/attachments/fichier/${piece.id}`)).status).toBe(403);
    expect((await dir.post(`/gouvernance/support/${d.body.id}/decision`, { decision: 'VALIDER', motDePasse: 'faux' })).status).toBe(400);
    const v = await dir.post(`/gouvernance/support/${d.body.id}/decision`, { decision: 'VALIDER', motDePasse: DEMO });
    expect(v.status).toBe(200);
    expect(v.body.statut).toBe('ACTIF');
    // Lecture de l’élément couvert, et de lui seul ; jamais d’écriture.
    expect((await admin.get(`/attachments/COURRIER/${courrier.id}`)).status).toBe(200);
    const f = await admin.get(`/attachments/fichier/${piece.id}`);
    expect(f.status).toBe(200);
    expect((await admin.get(`/attachments/COURRIER/${autre.id}`)).status).toBe(403);
    const ecriture = await request(app).post(`/api/attachments/COURRIER/${courrier.id}`).set('Authorization', `Bearer ${await loginAdmin()}`).attach('fichiers', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(ecriture.status).toBe(403);
    const trace = await db('audit_logs').where({ action: 'ACCES_SUPPORT', entite: 'attachment', entite_id: String(piece.id) }).first();
    expect(trace.message).toMatch(new RegExp(`accès de support n° ${d.body.id}`));
    expect((await db('acces_support').where({ id: d.body.id }).first()).consultations).toBeGreaterThanOrEqual(2);
    // Fin anticipée par l’Admin.
    expect((await admin.post(`/gouvernance/support/${d.body.id}/terminer`)).status).toBe(200);
    expect((await admin.get(`/attachments/fichier/${piece.id}`)).status).toBe(403);
  });

  test('révocation par le Directeur et expiration automatique', async () => {
    const d = await admin.post('/gouvernance/support', { motif: 'Contrôle d’un fichier corrompu', entity_type: 'COURRIER', duree_minutes: 60 });
    await dir.post(`/gouvernance/support/${d.body.id}/decision`, { decision: 'VALIDER', motDePasse: DEMO });
    expect((await admin.get(`/attachments/COURRIER/${autre.id}`)).status).toBe(200); // tous les courriers
    expect((await dir.post(`/gouvernance/support/${d.body.id}/decision`, { decision: 'REVOQUER', motDePasse: DEMO, commentaire: 'Intervention terminée' })).status).toBe(200);
    expect((await admin.get(`/attachments/COURRIER/${autre.id}`)).status).toBe(403);

    const e = await admin.post('/gouvernance/support', { motif: 'Vérification du stockage des pièces', duree_minutes: 15 });
    await dir.post(`/gouvernance/support/${e.body.id}/decision`, { decision: 'VALIDER', motDePasse: DEMO });
    expect((await admin.get(`/attachments/COURRIER/${autre.id}`)).status).toBe(200);
    await db('acces_support').where({ id: e.body.id }).update({ fin_at: db.raw(`now() - interval '1 minute'`) });
    expect((await admin.get(`/attachments/COURRIER/${autre.id}`)).status).toBe(403);
    await jobs.gouvernancePeriodique();
    expect((await db('acces_support').where({ id: e.body.id }).first()).statut).toBe('EXPIRE');
    // Le Directeur voit toutes les demandes.
    expect((await dir.get('/gouvernance/support')).body.data.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Compte d’urgence', () => {
  let admin; let dir; let urgenceId;
  beforeAll(async () => {
    admin = api(await loginAdmin());
    dir = api(await login('directeur'));
    urgenceId = (await db('users').where({ compte_urgence: true }).first()).id;
  });
  afterAll(async () => { await require('../src/services/gouvernance').fermerUrgence({ par: 'tests', motif: 'Fin des tests' }); });

  test('scellé : inutilisable et non administrable par l’Admin', async () => {
    const u = await db('users').where({ id: urgenceId }).first();
    expect(u).toMatchObject({ username: 'urgence', statut: 'DESACTIVE' });
    expect((await request(app).post('/api/auth/login').send({ username: 'urgence', password: 'dep@2026' })).status).toBe(401);
    expect((await admin.post(`/users/${urgenceId}/activer`)).body.error.code).toBe('COMPTE_URGENCE');
    expect((await admin.post(`/users/${urgenceId}/reinitialiser-mot-de-passe`)).body.error.code).toBe('COMPTE_URGENCE');
    expect((await admin.post('/gouvernance/urgence/activer', { motif: 'Tentative par l’Admin', heures: 2, motDePasse: ADMIN_NEW })).status).toBe(403);
    // La vérification de sécurité le signale scellé et ne le compte pas parmi les Admins.
    const v = (await admin.post('/securite/verification')).body.controles;
    expect(v.find((c) => c.controle === 'Compte d’urgence')).toMatchObject({ statut: 'OK' });
    expect(v.find((c) => c.controle === 'Nombre de comptes Admin Système').statut).toBe('OK');
  });

  test('activation par le Directeur, connexion signalée, fermeture par l’Admin', async () => {
    expect((await dir.post('/gouvernance/urgence/activer', { motif: 'Admin indisponible, panne du serveur de messagerie', heures: 30, motDePasse: DEMO })).status).toBe(400);
    expect((await dir.post('/gouvernance/urgence/activer', { motif: 'Admin indisponible, panne du serveur de messagerie', heures: 4, motDePasse: 'faux' })).status).toBe(400);
    const a = await dir.post('/gouvernance/urgence/activer', { motif: 'Admin indisponible, panne du serveur de messagerie', heures: 4, motDePasse: DEMO });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ username: 'urgence', motDePasseTemporaire: expect.any(String) });
    expect(await db('alertes_securite').where({ type: 'URGENCE_ACTIVE', gravite: 'CRITIQUE' }).first()).toBeTruthy();
    expect(await db('notifications').where({ user_id: await userId('sg'), titre: 'Compte d’urgence activé' }).first()).toBeTruthy();
    expect((await dir.post('/gouvernance/urgence/activer', { motif: 'Seconde activation simultanée', heures: 2, motDePasse: DEMO })).status).toBe(409);
    // Connexion : alerte immédiate ; nouveau mot de passe puis double authentification (sans autre étape).
    const l = await request(app).post('/api/auth/login').send({ username: 'urgence', password: a.body.motDePasseTemporaire });
    expect(l.status).toBe(200);
    expect(l.body.user.exigences).toEqual(['MOT_DE_PASSE', 'DEUX_FACTEURS']);
    expect(await db('alertes_securite').where({ type: 'URGENCE_CONNEXION' }).first()).toBeTruthy();
    expect(await db('notifications').where({ user_id: await userId('sg'), titre: 'Connexion au compte d’urgence' }).first()).toBeTruthy();
    expect((await db('activations_urgence').whereNull('fin_at').first()).connexions).toBe(1);
    // Fermeture par l’Admin principal : le compte est rescellé.
    expect((await admin.post('/gouvernance/urgence/fermer', { motif: 'Intervention terminée' })).status).toBe(200);
    expect((await db('users').where({ id: urgenceId }).first()).statut).toBe('DESACTIVE');
    expect((await request(app).post('/api/auth/login').send({ username: 'urgence', password: a.body.motDePasseTemporaire })).status).toBe(401);
    const e = (await dir.get('/gouvernance/urgence')).body;
    expect(e).toMatchObject({ actif: false });
    expect(e.historique[0]).toMatchObject({ active_par: 'directeur', ferme_par: 'admin', connexions: 1 });
  });

  test('activation par le SG et fermeture automatique à l’échéance', async () => {
    const sg = api(await login('sg'));
    const a = await sg.post('/gouvernance/urgence/activer', { motif: 'Directeur en mission, intervention urgente', heures: 1, motDePasse: DEMO });
    expect(a.status).toBe(200);
    await db('users').where({ id: urgenceId }).update({ urgence_jusqua: db.raw(`now() - interval '1 minute'`) });
    // Connexion refusée après l’échéance, même avant le passage de la tâche planifiée.
    expect((await request(app).post('/api/auth/login').send({ username: 'urgence', password: a.body.motDePasseTemporaire })).status).toBe(401);
    expect((await db('users').where({ id: urgenceId }).first()).statut).toBe('DESACTIVE');
    // Tâche planifiée : fermeture d’une activation échue.
    const b = await sg.post('/gouvernance/urgence/activer', { motif: 'Seconde intervention planifiée', heures: 1, motDePasse: DEMO });
    expect(b.status).toBe(200);
    await db('users').where({ id: urgenceId }).update({ urgence_jusqua: db.raw(`now() - interval '1 minute'`) });
    await jobs.gouvernancePeriodique();
    expect((await db('users').where({ id: urgenceId }).first()).statut).toBe('DESACTIVE');
    expect((await db('activations_urgence').orderBy('id', 'desc').first()).motif_fermeture).toMatch(/Échéance/);
  });

  test('procédure serveur (ligne de commande)', async () => {
    const g = require('../src/services/gouvernance');
    await expect(g.activerUrgence({ par: 'procédure serveur', motif: 'court', heures: 2 })).rejects.toThrow(/Motif/);
    const r = await g.activerUrgence({ par: 'procédure serveur (test)', motif: 'Aucun responsable joignable', heures: 2 });
    expect(r.motDePasseTemporaire).toBeTruthy();
    expect(await g.fermerUrgence({ par: 'procédure serveur (test)' })).toBe(true);
    expect(await g.fermerUrgence({ par: 'procédure serveur (test)' })).toBe(false);
  });
});
