'use strict';
/**
 * Lot 1 — Sécurité du compte Admin Système :
 * première connexion (mot de passe, 2FA, récupération, règles), connexion en deux temps,
 * politique des mots de passe, gestion des comptes et sessions, rôles protégés,
 * journal d’audit chaîné, alertes et vérification de sécurité.
 */
const bcrypt = require('bcrypt');
const { authenticator } = require('otplib');
const config = require('../src/config/env');
const { dechiffrer } = require('../src/services/deuxFacteurs');
const { invalider } = require('../src/services/politique');
const { db, request, app, login, loginAdmin, api, userId, connexion, avecConfirmation, ADMIN_NEW } = require('./helpers');

/** Crée directement un second compte technique « neuf » pour dérouler la première connexion. */
async function compteNeuf(username) {
  const role = await db('roles').where({ code: 'ADMIN_SYSTEME' }).first();
  const [u] = await db('users').insert({ username, password_hash: await bcrypt.hash('dep@2026', 10), statut: 'ACTIF', must_change_password: true }).returning('*');
  await db('user_roles').insert({ user_id: u.id, role_id: role.id });
  return u;
}

describe('Première connexion de l’Admin Système', () => {
  let u; let token; let codes;
  beforeAll(async () => { u = await compteNeuf('admin.neuf'); });
  afterAll(async () => { await db('users').where({ id: u.id }).update({ statut: 'DESACTIVE' }); });

  test('le mot de passe temporaire doit être changé, selon la politique', async () => {
    const l = await connexion('admin.neuf', 'dep@2026');
    expect(l.status).toBe(200);
    expect(l.body.user.exigences).toEqual(['MOT_DE_PASSE', 'DEUX_FACTEURS', 'EMAIL_RECUPERATION', 'REGLES']);
    token = l.body.accessToken;
    expect((await api(token).get('/users')).body.error.code).toBe('CHANGEMENT_MDP_REQUIS');
    const changer = (n) => request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${token}`).send({ currentPassword: 'dep@2026', newPassword: n });
    expect((await changer('court1!A')).body.error.code).toBe('MOT_DE_PASSE_NON_CONFORME');
    expect((await changer('sansmajuscule2026!')).body.error.message).toMatch(/majuscule/);
    expect((await changer('Azerty2026!!')).body.error.message).toMatch(/courant/);
    expect((await changer('Admin.Neuf#2026x')).body.error.message).toMatch(/nom d’utilisateur/);
    const ok = await changer('Tanganyika#2026');
    expect(ok.status).toBe(200);
    token = ok.body.accessToken;
  });

  test('tant que la configuration n’est pas terminée, l’application reste inaccessible', async () => {
    const r = await api(token).get('/users');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CONFIGURATION_SECURITE_REQUISE');
  });

  test('activation de la double authentification et codes de secours', async () => {
    const p = await api(token).post('/auth/2fa/preparer');
    expect(p.status).toBe(200);
    expect(p.body.qr).toMatch(/^data:image\/png;base64,/);
    const secret = p.body.secret.replace(/\s/g, '');
    // Le secret n’est jamais stocké en clair
    const enBase = (await db('users').where({ id: u.id }).first()).totp_secret;
    expect(enBase).not.toContain(secret);
    expect(dechiffrer(enBase)).toBe(secret);
    expect((await api(token).post('/auth/2fa/activer', { code: '000000' })).status).toBe(400);
    const a = await api(token).post('/auth/2fa/activer', { code: authenticator.generate(secret) });
    expect(a.status).toBe(200);
    codes = a.body.codesSecours;
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(a.body.user.exigences).toEqual(['EMAIL_RECUPERATION', 'REGLES']);
    expect((await api(token).post('/auth/2fa/preparer')).status).toBe(400);
  });

  test('adresse de récupération puis acceptation des règles', async () => {
    expect((await api(token).post('/auth/email-recuperation', { email: 'pas-une-adresse' })).status).toBe(400);
    const e = await api(token).post('/auth/email-recuperation', { email: 'Securite.DEP@example.cd' });
    expect(e.status).toBe(200);
    expect(e.body.user.exigences).toEqual(['REGLES']);
    const r = await api(token).get('/auth/regles');
    expect(r.body.regles.length).toBeGreaterThanOrEqual(5);
    expect((await api(token).post('/auth/regles/accepter', { version: r.body.version + 1 })).status).toBe(400);
    const ok = await api(token).post('/auth/regles/accepter', { version: r.body.version });
    expect(ok.body.user.exigences).toEqual([]);
    expect((await api(token).get('/users')).status).toBe(200);
    const traces = await db('audit_logs').where({ user_id: u.id }).pluck('action');
    expect(traces).toEqual(expect.arrayContaining(['CHANGEMENT_MDP', 'ACTIVATION_2FA', 'EMAIL_RECUPERATION', 'ACCEPTATION_REGLES']));
  });

  test('connexion en deux temps : mot de passe, puis code ou code de secours (usage unique)', async () => {
    const l = await request(app).post('/api/auth/login').send({ username: 'admin.neuf', password: 'Tanganyika#2026' });
    expect(l.body).toMatchObject({ deuxFacteurs: true });
    expect(l.body.accessToken).toBeUndefined();
    expect(l.headers['set-cookie']).toBeUndefined();
    const mauvais = await request(app).post('/api/auth/login/deux-facteurs').send({ defi: l.body.defi, code: '123456' });
    expect(mauvais.status).toBe(401);
    const bon = await request(app).post('/api/auth/login/deux-facteurs').send({ defi: l.body.defi, code: codes[0] });
    expect(bon.status).toBe(200);
    expect(bon.body.accessToken).toBeTruthy();
    // Le défi et le code de secours ne servent qu’une fois
    expect((await request(app).post('/api/auth/login/deux-facteurs').send({ defi: l.body.defi, code: codes[1] })).status).toBe(401);
    const l2 = await request(app).post('/api/auth/login').send({ username: 'admin.neuf', password: 'Tanganyika#2026' });
    expect((await request(app).post('/api/auth/login/deux-facteurs').send({ defi: l2.body.defi, code: codes[0] })).status).toBe(401);
    expect(await db('alertes_securite').where({ type: 'CODE_SECOURS', user_id: u.id }).first()).toBeTruthy();
    // Un ancien mot de passe ne peut pas être réutilisé
    const t = bon.body.accessToken;
    const re = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${t}`).send({ currentPassword: 'Tanganyika#2026', newPassword: 'Tanganyika#2026' });
    expect(re.status).toBe(400);
  });
});

describe('Récupération du mot de passe', () => {
  const saved = { ...config.mail };
  afterAll(() => { Object.assign(config.mail, saved); });

  test('code par e-mail + second facteur ; réponse identique pour un compte inconnu', async () => {
    Object.assign(config.mail, { enabled: true, transport: 'json' });
    const u = await db('users').where({ username: 'admin.neuf' }).first();
    await db('users').where({ id: u.id }).update({ statut: 'ACTIF', email_recuperation_verifie_at: db.fn.now() });
    const inconnu = await request(app).post('/api/auth/recuperation/demander').send({ username: 'personne' });
    const d = await request(app).post('/api/auth/recuperation/demander').send({ username: 'admin.neuf' });
    expect(d.body.message).toBe(inconnu.body.message);
    const mail = await db('email_outbox').where({ to_email: 'securite.dep@example.cd' }).orderBy('id', 'desc').first();
    const code = mail.text_body.match(/Code de récupération : (\d{6})/)[1];
    const base = { username: 'admin.neuf', code, nouveauMotDePasse: 'Lualaba#Secours27' };
    expect((await request(app).post('/api/auth/recuperation/confirmer').send({ ...base, codeDeuxFacteurs: '111111' })).status).toBe(400);
    const totp = authenticator.generate(dechiffrer(u.totp_secret));
    const ok = await request(app).post('/api/auth/recuperation/confirmer').send({ ...base, codeDeuxFacteurs: totp });
    expect(ok.status).toBe(200);
    expect((await connexion('admin.neuf', 'Lualaba#Secours27')).status).toBe(200);
    expect(await db('alertes_securite').where({ type: 'RECUPERATION', user_id: u.id }).first()).toBeTruthy();
    await db('users').where({ id: u.id }).update({ statut: 'DESACTIVE' });
  });
});

describe('Gestion des comptes, sessions et rôles par l’Admin', () => {
  let admin;
  beforeAll(async () => { admin = api(await loginAdmin()); });

  test('nouvelles permissions et rôle renommé', async () => {
    const me = (await admin.get('/auth/me')).body.user;
    expect(me.roles).toEqual(['ADMIN_SYSTEME']);
    expect(me.permissions).toEqual(expect.arrayContaining(['systeme.consulter', 'securite.superviser', 'session.consulter', 'audit.exporter', 'compte.desactiver', 'sauvegarde.creer']));
    expect(me.permissions).not.toContain('liste.valider');
    expect(me.permissions.some((p) => /^(instructions|taches|presences|courriers|documents|pip|personnel)\./.test(p))).toBe(false);
  });

  test('bloquer temporairement, imposer un changement de mot de passe, débloquer', async () => {
    const id = await userId('ag.prg1');
    expect((await admin.post(`/users/${id}/bloquer`, { minutes: 60 })).status).toBe(400); // motif requis
    expect((await admin.post(`/users/${id}/bloquer`, { minutes: 60, motif: 'Compte compromis (test)' })).status).toBe(200);
    const l = await request(app).post('/api/auth/login').send({ username: 'ag.prg1', password: 'Demo@2026' });
    expect(l.status).toBe(423);
    expect((await admin.post(`/users/${id}/deverrouiller`)).status).toBe(200);
    expect((await admin.post(`/users/${id}/imposer-changement`)).status).toBe(200);
    const t = await login('ag.prg1');
    expect((await api(t).get('/taches')).body.error.code).toBe('CHANGEMENT_MDP_REQUIS');
    await db('users').where({ id }).update({ must_change_password: false });
  });

  test('sessions actives : liste avec IP et fermeture d’une session', async () => {
    await login('ag.prg2');
    const s = await admin.get('/securite/sessions');
    expect(s.status).toBe(200);
    const mine = s.body.data.find((x) => x.username === 'ag.prg2');
    expect(mine).toMatchObject({ ip: expect.any(String) });
    expect((await admin.post(`/securite/sessions/${mine.family_id}/revoquer`, { motif: 'Session suspecte' })).status).toBe(200);
    const after = await admin.get('/securite/sessions');
    expect(after.body.data.some((x) => x.family_id === mine.family_id)).toBe(false);
    expect((await api(await login('directeur')).get('/securite/sessions')).status).toBe(403);
  });

  test('comptes inactifs détectés', async () => {
    const id = await userId('ag.sev2');
    await db('users').where({ id }).update({ last_login_at: db.raw(`now() - interval '200 days'`) });
    const r = await admin.get('/users?inactifs=1');
    expect(r.body.data.map((u) => u.username)).toContain('ag.sev2');
    expect(r.body.data.find((u) => u.username === 'ag.sev2').inactif).toBe(true);
    await db('users').where({ id }).update({ last_login_at: db.fn.now() });
  });

  test('l’Admin ne fait personne Directeur ou Chef de Division sans décision ; rôles protégés', async () => {
    const r = await admin.put(`/users/${await userId('cb.prg')}/roles`, { roles: ['CHEF_DIVISION'] });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('DECISION_ADMINISTRATIVE_REQUISE');
    expect((await admin.put(`/users/${await userId('cd.ps')}/roles`, { roles: ['CHEF_BUREAU'] })).body.error.code).toBe('DECISION_ADMINISTRATIVE_REQUISE');
    // Permissions techniques interdites aux rôles institutionnels ; rôle Admin protégé
    const agent = await admin.put('/users/roles/AGENT/permissions', { permissions: ['organisation.consulter', 'sauvegarde.restaurer'] });
    expect(agent.body.error.code).toBe('PERMISSION_INCOMPATIBLE');
    // Rôle Admin Système : aucune permission métier ; toute autre modification exige la confirmation du Directeur.
    expect((await admin.put('/users/roles/ADMIN_SYSTEME/permissions', { permissions: ['audit.consulter', 'documents.valider_final'] })).body.error.code).toBe('PERMISSION_INCOMPATIBLE');
    const attente = await admin.put('/users/roles/ADMIN_SYSTEME/permissions', { permissions: ['audit.consulter'] });
    expect(attente.status).toBe(202);
    expect(attente.body.demande.type).toBe('ROLE_ADMIN');
    expect((await admin.post(`/gouvernance/confirmations/${attente.body.demande.id}/annuler`)).status).toBe(200);
    await expect(db('roles').where({ code: 'DIRECTEUR' }).update({ libelle: 'Chef' })).rejects.toThrow(/ROLE_PROTEGE/);
    await expect(db('roles').where({ code: 'AGENT' }).del()).rejects.toThrow(/ROLE_PROTEGE/);
  });
});

describe('Politique de sécurité', () => {
  let admin;
  beforeAll(async () => { admin = api(await loginAdmin()); });
  afterAll(async () => { await db('parametres').where({ cle: 'mdp_longueur_min' }).update({ valeur: '10' }); invalider(); });

  test('bornes contrôlées, modification tracée et signalée', async () => {
    expect((await admin.get('/securite/politique')).body.valeurs.mdp_longueur_min).toBe(10);
    expect((await admin.put('/securite/politique', { mdp_longueur_min: 4 })).status).toBe(400);
    expect((await admin.put('/securite/politique', { inconnu: 3 })).status).toBe(400);
    expect((await avecConfirmation(admin, 'put', '/securite/politique', { mdp_longueur_min: 12 })).status).toBe(200);
    expect(await db('alertes_securite').where({ type: 'POLITIQUE' }).first()).toBeTruthy();
    expect(await db('audit_logs').where({ action: 'POLITIQUE_SECURITE' }).first()).toBeTruthy();
    // Non modifiable par le contournement des paramètres généraux
    expect((await admin.put('/systeme/parametres/mdp_longueur_min', { valeur: '4' })).status).toBe(400);
    expect((await api(await login('directeur')).put('/securite/politique', { mdp_longueur_min: 8 })).status).toBe(403);
  });
});

describe('Journal d’audit infalsifiable et vérification de sécurité', () => {
  let admin;
  beforeAll(async () => { admin = api(await loginAdmin()); });

  test('chaîne intègre ; toute altération directe en base est détectée', async () => {
    const ok = await admin.get('/audit/integrite');
    expect(ok.body.integre).toBe(true);
    const cible = await db('audit_logs').orderBy('maillon').offset(3).first();
    await db.raw('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_append_only');
    await db('audit_logs').where({ id: cible.id }).update({ username: 'falsifie' });
    const ko = await admin.get('/audit/integrite');
    expect(ko.body.integre).toBe(false);
    expect(ko.body.problemes[0]).toMatchObject({ maillon: Number(cible.maillon), raison: 'Contenu modifié' });
    expect(await db('alertes_securite').where({ type: 'AUDIT_INTEGRITE' }).first()).toBeTruthy();
    await db('audit_logs').where({ id: cible.id }).update({ username: cible.username });
    await db.raw('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_append_only');
    expect((await admin.get('/audit/integrite')).body.integre).toBe(true);
  });

  test('ni suppression, ni modification, ni troncature des traces et des connexions', async () => {
    await expect(db('audit_logs').where('id', '>', 0).del()).rejects.toThrow(/APPEND_ONLY/);
    await expect(db.raw('TRUNCATE audit_logs')).rejects.toThrow(/APPEND_ONLY/);
    await expect(db('login_history').where({ succes: false }).del()).rejects.toThrow(/APPEND_ONLY/);
    await expect(db.raw('TRUNCATE login_history')).rejects.toThrow(/APPEND_ONLY/);
  });

  test('export du journal (CSV, PDF) réservé à audit.exporter et tracé', async () => {
    const csv = await admin.get('/audit/export/csv');
    expect(csv.status).toBe(200);
    expect(csv.text).toMatch(/Maillon/);
    expect((await admin.get('/audit/export/pdf')).headers['content-type']).toMatch(/pdf/);
    expect(await db('audit_logs').where({ action: 'EXPORT', module: 'audit' }).first()).toBeTruthy();
  });

  test('alertes : tentatives sur un compte Admin, vague d’échecs, acquittement', async () => {
    for (let i = 0; i < 2; i++) await request(app).post('/api/auth/login').send({ username: 'admin', password: 'mauvais' });
    const a = await admin.get('/securite/alertes');
    expect(a.body.data.some((x) => x.type === 'ECHEC_ADMIN')).toBe(true);
    const al = a.body.data[0];
    expect((await admin.post(`/securite/alertes/${al.id}/acquitter`, { commentaire: 'Vérifié' })).status).toBe(200);
    expect((await admin.post(`/securite/alertes/${al.id}/acquitter`, {})).status).toBe(400);
    // Remise à zéro du compteur d’échecs de l’Admin pour les autres suites
    await db('users').where({ username: 'admin' }).update({ failed_attempts: 0 });
    const c = await admin.get('/securite/connexions?resultat=echec');
    expect(c.body.data.length).toBeGreaterThan(0);
    expect(c.body.ipsSuspectes.length).toBeGreaterThan(0);
  });

  test('vérification de sécurité', async () => {
    const v = await admin.post('/securite/verification');
    expect(v.status).toBe(200);
    const noms = v.body.controles.map((c) => c.controle);
    expect(noms).toEqual(expect.arrayContaining(['Intégrité du journal d’audit', 'Double authentification des Admins', 'Fichiers téléversés', 'Dernière sauvegarde']));
    expect(v.body.controles.find((c) => c.controle === 'Intégrité du journal d’audit').statut).toBe('OK');
    expect((await api(await login('directeur')).post('/securite/verification')).status).toBe(403);
  });

  test('la connexion réussie de l’Admin exige toujours le second facteur', async () => {
    const l = await request(app).post('/api/auth/login').send({ username: 'admin', password: ADMIN_NEW });
    expect(l.body.deuxFacteurs).toBe(true);
    expect(l.body.accessToken).toBeUndefined();
  });
});
