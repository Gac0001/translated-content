'use strict';
/**
 * Notifications par e-mail : mise en file, préférences, confidentialité, réessais,
 * envoi SMTP réel vers un serveur de test local, administration.
 */
process.env.MAIL_ENABLED = 'true';
process.env.MAIL_TRANSPORT = 'json';
process.env.APP_URL = 'https://sig-dep.test';

const { SMTPServer } = require('smtp-server');
const { db, login, loginAdmin, api, userId } = require('./helpers');
const config = require('../src/config/env');
const mailer = require('../src/services/mailer');

const outboxFor = async (username) => db('email_outbox').where({ user_id: await userId(username) }).orderBy('id', 'desc');

// La configuration est chargée avant ce fichier (setupFilesAfterEnv) : on la fixe explicitement.
const reset = () => {
  Object.assign(config.mail, { enabled: true, transport: 'json', appUrl: 'https://sig-dep.test', maxAttempts: 5 });
  mailer.resetTransport();
};
beforeAll(reset);
afterEach(reset);

describe('Mise en file des e-mails', () => {
  test('une instruction génère un e-mail au destinataire, avec lien vers l’élément', async () => {
    const dir = api(await login('directeur'));
    const r = await dir.post('/instructions', { destinataire_user_id: await userId('cd.etudes'), objet: 'Étude « accès & usages »', contenu: 'Préparer les TDR' });
    expect(r.status).toBe(201);
    const [m] = await outboxFor('cd.etudes');
    expect(m).toMatchObject({ type: 'INSTRUCTION', statut: 'EN_ATTENTE', to_email: 'cd.etudes@economie-numerique.gouv.cd' });
    expect(m.subject).toContain('Étude « accès & usages »');
    expect(m.html_body).toContain(`https://sig-dep.test/instructions/${r.body.id}`);
    expect(m.html_body).toContain('Étude « accès &amp; usages »'); // échappement HTML
    expect(m.html_body).toContain('DIRECTION D’ÉTUDES ET PLANIFICATION');
    expect(m.text_body).toContain('Direction d’Études et Planification');
  });

  test('le traitement de la file envoie les e-mails en attente', async () => {
    const r = await mailer.processOutbox(100);
    expect(r.envoyes).toBeGreaterThan(0);
    const [m] = await outboxFor('cd.etudes');
    expect(m.statut).toBe('ENVOYE');
    expect(m.sent_at).toBeTruthy();
  });

  test('un courrier confidentiel : l’e-mail ne révèle ni l’objet ni le contenu', async () => {
    const cbs = api(await login('cb.secretariat'));
    const c = await cbs.post('/courriers', { sens: 'ENTRANT', expediteur: 'Cabinet', destinataire: 'Directeur', objet: 'Dossier Orion très sensible', date_courrier: '2026-09-20', confidentialite: 'CONFIDENTIEL' });
    await cbs.post(`/courriers/${c.body.id}/transmettre`, { to_user_id: await userId('directeur') });
    const [m] = await outboxFor('directeur');
    expect(m.type).toBe('COURRIER');
    expect(m.subject).toBe('[SIG-DEP] Élément confidentiel à consulter');
    for (const body of [m.subject, m.text_body, m.html_body]) expect(body).not.toContain('Orion');
    // La notification interne, elle, reste complète pour le destinataire habilité
    const n = await db('notifications').where({ id: m.notification_id }).first();
    expect(n.message).toContain('Orion');
  });

  test('le mot de passe temporaire n’est jamais envoyé par e-mail', async () => {
    const admin = api(await loginAdmin());
    const r = await admin.post(`/users/${await userId('ag.pls2')}/reinitialiser-mot-de-passe`);
    const [m] = await outboxFor('ag.pls2');
    expect(m.type).toBe('MDP_REINITIALISE');
    expect(m.text_body).not.toContain(r.body.motDePasseTemporaire);
    expect(m.html_body).not.toContain(r.body.motDePasseTemporaire);
  });

  test('aucun e-mail pour un Agent sans adresse électronique (la notification interne est créée)', async () => {
    const u = await db('users').where({ username: 'ag.vtp1' }).first();
    await db('agents').where({ id: u.agent_id }).update({ email: null });
    const t = await api(await login('cb.vtp')).post('/taches', { agent_user_id: u.id, titre: 'Tâche sans e-mail' });
    expect(t.status).toBe(201);
    expect(await outboxFor('ag.vtp1')).toHaveLength(0);
    expect(await db('notifications').where({ user_id: u.id, type: 'TACHE' }).first()).toBeTruthy();
  });

  test('messagerie désactivée : rien n’est mis en file', async () => {
    config.mail.enabled = false;
    await api(await login('cb.pls')).post('/taches', { agent_user_id: await userId('ag.pls1'), titre: 'Tâche hors messagerie' });
    expect((await outboxFor('ag.pls1')).filter((m) => m.subject.includes('Tâche hors messagerie'))).toHaveLength(0);
  });
});

describe('Préférences de notification', () => {
  test('un type désactivé ou la messagerie coupée par l’utilisateur supprime l’e-mail', async () => {
    const ag = api(await login('ag.est2'));
    const p = await ag.get('/notifications/preferences');
    expect(p.body).toMatchObject({ messagerieActive: true, emailActif: true, email: 'ag.est2@economie-numerique.gouv.cd' });
    expect(p.body.types.map((t) => t.code)).toContain('TACHE');
    expect((await ag.put('/notifications/preferences', { emailActif: true, typesDesactives: ['TACHE'] })).status).toBe(200);
    const cb = api(await login('cb.est'));
    await cb.post('/taches', { agent_user_id: await userId('ag.est2'), titre: 'Préférence TACHE désactivée' });
    expect((await outboxFor('ag.est2')).some((m) => m.subject.includes('Préférence TACHE'))).toBe(false);
    await ag.put('/notifications/preferences', { emailActif: false, typesDesactives: [] });
    await cb.post('/taches', { agent_user_id: await userId('ag.est2'), titre: 'Messagerie coupée' });
    expect((await outboxFor('ag.est2')).some((m) => m.subject.includes('Messagerie coupée'))).toBe(false);
    await ag.put('/notifications/preferences', { emailActif: true, typesDesactives: [] });
    await cb.post('/taches', { agent_user_id: await userId('ag.est2'), titre: 'Messagerie rétablie' });
    expect((await outboxFor('ag.est2')).some((m) => m.subject.includes('Messagerie rétablie'))).toBe(true);
  });

  test('type inconnu refusé', async () => {
    const r = await api(await login('ag.est2')).put('/notifications/preferences', { emailActif: true, typesDesactives: ['INEXISTANT'] });
    expect(r.status).toBe(400);
  });
});

describe('Envoi SMTP et réessais', () => {
  let server; let recus = [];
  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true, disabledCommands: ['STARTTLS'], logger: false,
      onData(stream, session, cb) {
        let raw = '';
        stream.on('data', (d) => { raw += d.toString('utf8'); });
        stream.on('end', () => { recus.push({ to: session.envelope.rcptTo.map((r) => r.address), raw }); cb(); });
      },
    });
    await new Promise((resolve) => server.listen(2525, '127.0.0.1', resolve));
  });
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

  test('envoi réel via SMTP : destinataire, sujet encodé, versions texte et HTML', async () => {
    Object.assign(config.mail, { transport: 'smtp', host: '127.0.0.1', port: 2525, secure: false, user: '' });
    mailer.resetTransport();
    recus = [];
    await db('email_outbox').where('statut', 'EN_ATTENTE').update({ statut: 'ANNULE' });
    await api(await login('directeur')).post('/instructions', { destinataire_user_id: await userId('cd.suivi'), objet: 'Synthèse SMTP', contenu: 'Test d’envoi' });
    const r = await mailer.processOutbox();
    expect(r).toEqual({ envoyes: 1, echecs: 0 });
    expect(recus).toHaveLength(1);
    expect(recus[0].to).toEqual(['cd.suivi@economie-numerique.gouv.cd']);
    expect(recus[0].raw).toMatch(/Subject: .*SIG-DEP/);
    expect(recus[0].raw).toContain('text/plain');
    expect(recus[0].raw).toContain('text/html');
    expect(recus[0].raw).toContain('Auto-Submitted: auto-generated');
  });

  test('serveur injoignable : réessai différé, puis échec définitif et relance par l’Admin', async () => {
    Object.assign(config.mail, { transport: 'smtp', host: '127.0.0.1', port: 2599, secure: false, maxAttempts: 2 });
    mailer.resetTransport();
    await db('email_outbox').where('statut', 'EN_ATTENTE').update({ statut: 'ANNULE' });
    await api(await login('directeur')).post('/instructions', { destinataire_user_id: await userId('cd.planification'), objet: 'Serveur en panne', contenu: 'Test' });
    let r = await mailer.processOutbox();
    expect(r).toEqual({ envoyes: 0, echecs: 1 });
    let [m] = await outboxFor('cd.planification');
    expect(m.statut).toBe('EN_ATTENTE');
    expect(m.tentatives).toBe(1);
    expect(m.derniere_erreur).toBeTruthy();
    expect(new Date(m.prochain_essai) > new Date()).toBe(true);
    // Pas de nouvel essai avant l’échéance du délai
    expect((await mailer.processOutbox()).echecs).toBe(0);
    await db('email_outbox').where({ id: m.id }).update({ prochain_essai: db.raw(`now() - interval '1 second'`) });
    r = await mailer.processOutbox();
    [m] = await outboxFor('cd.planification');
    expect(m.statut).toBe('ECHEC');
    const admin = api(await loginAdmin());
    expect((await admin.post('/systeme/messagerie/relancer')).body.relances).toBeGreaterThanOrEqual(1);
    [m] = await outboxFor('cd.planification');
    expect(m).toMatchObject({ statut: 'EN_ATTENTE', tentatives: 0 });
    config.mail.maxAttempts = 5;
  });
});

describe('Administration de la messagerie', () => {
  test('état de la messagerie, e-mail de test ; réservé à l’Admin', async () => {
    const admin = api(await loginAdmin());
    const r = await admin.get('/systeme/messagerie');
    expect(r.status).toBe(200);
    expect(r.body.configuration.active).toBe(true);
    expect(r.body.configuration).not.toHaveProperty('motDePasse');
    expect(JSON.stringify(r.body)).not.toContain(config.mail.pass || '§§');
    expect(typeof r.body.comptesSansAdresse).toBe('number');
    expect((await admin.post('/systeme/messagerie/test', { destinataire: 'admin@exemple.cd' })).status).toBe(200);
    expect((await admin.post('/systeme/messagerie/test', { destinataire: 'invalide' })).status).toBe(400);
    expect((await admin.post('/systeme/messagerie/verifier')).body.ok).toBe(true);
    expect((await api(await login('directeur')).get('/systeme/messagerie')).status).toBe(403);
  });
});
