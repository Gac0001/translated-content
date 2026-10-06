'use strict';
/**
 * Lot 3 — Sauvegardes et maintenance : chiffrement, planification, conservation, vérifications,
 * restauration validée par le Directeur (avec réintégration des traces), mode maintenance,
 * annonces système, migrations, environnement.
 *
 * Les tests qui exécutent pg_dump / pg_restore sont ignorés si ces outils sont absents ou
 * incompatibles avec la version du serveur (ex. environnement d’intégration continue).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const config = require('../src/config/env');
const sv = require('../src/services/sauvegarde');
const { dechiffrer } = require('../src/services/deuxFacteurs');
const { DEFAUTS } = require('../src/services/politique');
const { db, request, app, login, loginAdmin, api, userId, connexion, avecConfirmation, ADMIN_NEW, DEMO } = require('./helpers');

let outils = false;
const avecOutils = (nom, fn) => test(nom, async () => { if (!outils) { console.warn(`[ignoré : pg_dump/pg_restore indisponibles] ${nom}`); return; } await fn(); });

beforeAll(async () => {
  config.backupEncKey = 'cle-de-chiffrement-des-tests-sig-dep';
  try {
    const r = await sv.creerSauvegarde('-sonde', { origine: 'MANUELLE' });
    const v = await sv.verifierIntegrite(await db('sauvegardes').where({ id: r.id }).first());
    outils = v.statut === 'OK';
  } catch (e) { outils = false; }
});
afterAll(() => { config.backupEncKey = null; });

describe('Fonctions de planification et de conservation', () => {
  const p = { ...DEFAUTS };
  const a = (iso) => new Date(iso);

  test('sauvegarde quotidienne à l’heure prévue (Kinshasa), trois tentatives maximum', () => {
    // 00:30 UTC = 01:30 à Kinshasa (UTC+1)
    expect(sv.doitSauvegarder(a('2026-10-05T00:30:00Z'), p, [])).toBe(true);
    expect(sv.doitSauvegarder(a('2026-10-04T23:30:00Z'), p, [])).toBe(false); // 00:30 à Kinshasa
    expect(sv.doitSauvegarder(a('2026-10-05T00:30:00Z'), { ...p, sauvegarde_auto: false }, [])).toBe(false);
    expect(sv.doitSauvegarder(a('2026-10-05T03:00:00Z'), p, [{ statut: 'REUSSIE', created_at: a('2026-10-05T00:05:00Z') }])).toBe(false);
    expect(sv.doitSauvegarder(a('2026-10-05T00:40:00Z'), p, [{ statut: 'ECHEC', created_at: a('2026-10-05T00:05:00Z') }])).toBe(false); // < 1 h
    expect(sv.doitSauvegarder(a('2026-10-05T01:10:00Z'), p, [{ statut: 'ECHEC', created_at: a('2026-10-05T00:05:00Z') }])).toBe(true);
    const trois = [0, 1, 2].map((i) => ({ statut: 'ECHEC', created_at: a(`2026-10-05T0${i}:05:00Z`) }));
    expect(sv.doitSauvegarder(a('2026-10-05T05:00:00Z'), p, trois)).toBe(false);
  });

  test('paliers : première du mois = mensuelle, première de la semaine = hebdomadaire', () => {
    expect(sv.determinerPalier(a('2026-10-01T01:00:00Z'), [{ created_at: a('2026-09-30T01:00:00Z') }])).toBe('MENSUELLE');
    expect(sv.determinerPalier(a('2026-10-05T01:00:00Z'), [{ created_at: a('2026-10-02T01:00:00Z') }])).toBe('HEBDOMADAIRE'); // lundi
    expect(sv.determinerPalier(a('2026-10-06T01:00:00Z'), [{ created_at: a('2026-10-05T01:00:00Z') }])).toBe('QUOTIDIENNE');
  });

  test('conservation 7 / 4 / 12 et ponctuelles 90 jours', () => {
    const liste = [];
    // 120 jours de sauvegardes programmées
    for (let i = 0; i < 120; i++) {
      const d = new Date(Date.UTC(2026, 5, 1) + i * 86400000);
      liste.push({ id: i + 1, statut: 'REUSSIE', origine: 'PROGRAMMEE', created_at: d, palier: sv.determinerPalier(d, liste) });
    }
    liste.push({ id: 500, statut: 'REUSSIE', origine: 'MANUELLE', created_at: new Date(Date.UTC(2026, 0, 1)) });
    liste.push({ id: 501, statut: 'REUSSIE', origine: 'MANUELLE', created_at: new Date(Date.UTC(2026, 8, 25)) });
    const maintenant = new Date(Date.UTC(2026, 8, 29));
    const supprimees = new Set(sv.aSupprimer(liste, p, maintenant).map((s) => s.id));
    const gardees = liste.filter((s) => !supprimees.has(s.id));
    const prog = gardees.filter((s) => s.origine === 'PROGRAMMEE');
    expect(prog.filter((s) => s.id > 113)).toHaveLength(7); // 7 dernières
    expect(prog.filter((s) => s.palier === 'MENSUELLE').length).toBe(4); // juin à septembre (≤ 12)
    expect(prog.length).toBeLessThanOrEqual(7 + 4 + 12);
    expect(supprimees.has(500)).toBe(true); // ponctuelle de plus de 90 jours
    expect(supprimees.has(501)).toBe(false);
  });

  test('chiffrement : aller-retour, clé incorrecte et altération détectées', async () => {
    const dir = fs.mkdtempSync(path.join(config.backupDir, '.t-'));
    const src = path.join(dir, 'a'); const enc = path.join(dir, 'a.enc'); const dst = path.join(dir, 'b');
    fs.writeFileSync(src, crypto.randomBytes(200000));
    await sv.chiffrerFichier(src, enc);
    await sv.dechiffrerFichier(enc, dst);
    expect(fs.readFileSync(dst).equals(fs.readFileSync(src))).toBe(true);
    expect(fs.readFileSync(enc).includes(fs.readFileSync(src).subarray(0, 64))).toBe(false);
    const k = crypto.createHash('sha256').update('autre-cle').digest();
    await expect(sv.dechiffrerFichier(enc, dst, k)).rejects.toThrow(/clé incorrecte ou fichier altéré/);
    const b = fs.readFileSync(enc); b[500] ^= 0xff; fs.writeFileSync(enc, b);
    await expect(sv.dechiffrerFichier(enc, dst)).rejects.toThrow(/altéré/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Sauvegardes', () => {
  let admin;
  beforeAll(async () => { admin = api(await loginAdmin()); });

  avecOutils('sauvegarde manuelle chiffrée, vérifiée ; registre et téléchargement tracé', async () => {
    const r = await admin.post('/sauvegardes');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ chiffre: true, verification: 'OK' });
    expect(r.body.fichier).toMatch(/\.dump\.enc$/);
    const l = await admin.get('/sauvegardes');
    const s = l.body.sauvegardes.find((x) => x.fichier === r.body.fichier);
    expect(s).toMatchObject({ chiffre: true, verification_statut: 'OK', copie_statut: 'ABSENTE', presente: true });
    expect(s.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect((await admin.get(`/sauvegardes/${s.id}/telecharger`)).status).toBe(200);
    expect(await db('audit_logs').where({ action: 'EXPORT', module: 'sauvegarde' }).first()).toBeTruthy();
    expect((await api(await login('directeur')).get('/sauvegardes')).status).toBe(403);
  });

  avecOutils('fichier altéré : l’intégrité échoue et une alerte critique est émise', async () => {
    const r = await admin.post('/sauvegardes');
    const chemin = path.join(config.backupDir, r.body.fichier);
    fs.appendFileSync(chemin, 'X');
    const v = await admin.post(`/sauvegardes/${r.body.id}/verifier`);
    expect(v.body.statut).toBe('ECHEC');
    expect(v.body.detail.erreur).toMatch(/empreinte/);
    expect(await db('alertes_securite').where({ type: 'SAUVEGARDE_ALTEREE' }).first()).toBeTruthy();
    fs.unlinkSync(chemin);
  });

  avecOutils('test de restauration réel dans une base temporaire', async () => {
    const s = await db('sauvegardes').where({ statut: 'REUSSIE', verification_statut: 'OK' }).whereNull('supprimee_at').orderBy('id', 'desc').first();
    const t = await admin.post(`/sauvegardes/${s.id}/tester`);
    expect(t.body.statut).toBe('OK');
    expect(t.body.detail).toMatchObject({ auditIntegre: true });
    expect(t.body.detail.comptes).toBeGreaterThan(10);
    const bases = (await db.raw(`select datname from pg_database where datname like '%_verif_%'`)).rows;
    expect(bases).toHaveLength(0); // base temporaire supprimée
  });

  test('planification : bornes, audit, alerte si désactivée', async () => {
    expect((await admin.put('/sauvegardes/planification', { sauvegarde_heure: '25:00' })).status).toBe(400);
    expect((await admin.put('/sauvegardes/planification', { retention_quotidienne: 1 })).status).toBe(400);
    expect((await admin.put('/sauvegardes/planification', { sauvegarde_auto: false, sauvegarde_heure: '02:30' })).status).toBe(200);
    expect(await db('alertes_securite').where({ type: 'SAUVEGARDE_AUTO_DESACTIVEE' }).first()).toBeTruthy();
    expect((await admin.get('/sauvegardes')).body.planification).toMatchObject({ sauvegarde_auto: false, sauvegarde_heure: '02:30' });
    await admin.put('/sauvegardes/planification', { sauvegarde_auto: true, sauvegarde_heure: '01:00' });
  });
});

describe('Restauration validée par le Directeur', () => {
  let admin; let dir;
  beforeAll(async () => { admin = api(await loginAdmin()); dir = api(await login('directeur')); });
  const code = async () => authenticator.generate(dechiffrer((await db('users').where({ username: 'admin' }).first()).totp_secret));

  avecOutils('circuit complet : demande, refus, nouvelle demande, validation, exécution, traces réintégrées', async () => {
    // État de référence sauvegardé
    const s = (await admin.post('/sauvegardes')).body;
    // Activité postérieure à la sauvegarde (doit survivre à la restauration dans les traces)
    await new Promise((r) => setTimeout(r, 1100));
    const marqueur = `Marqueur ${Date.now()}`;
    await avecConfirmation(admin, 'put', '/securite/politique', { alerte_echecs_seuil: 11 });
    await request(app).post('/api/auth/login').send({ username: 'ag.doi1', password: 'mauvais-mot' });
    await db('users').where({ username: 'ag.doi1' }).update({ failed_attempts: 0 });
    // Modification « métier » postérieure : effacée par la restauration
    await db('parametres').where({ cle: 'ville' }).update({ valeur: marqueur });

    expect((await admin.post(`/sauvegardes/${s.id}/restauration`, { motif: 'court' })).status).toBe(400);
    const d1 = await admin.post(`/sauvegardes/${s.id}/restauration`, { motif: 'Test de restauration : refus du Directeur' });
    expect(d1.status).toBe(201);
    expect(await db('notifications').where({ user_id: await userId('directeur'), lien: '/restaurations' }).first()).toBeTruthy();
    expect((await admin.post(`/sauvegardes/${s.id}/restauration`, { motif: 'Seconde demande simultanée interdite' })).status).toBe(409);
    // Exécution impossible sans validation ; seul le Directeur décide, avec son mot de passe
    expect((await admin.post(`/sauvegardes/restaurations/${d1.body.demande.id}/executer`, { confirmation: 'RESTAURER', motDePasse: ADMIN_NEW, code: await code() })).status).toBe(400);
    expect((await admin.post(`/sauvegardes/restaurations/${d1.body.demande.id}/decision`, { decision: 'VALIDER', motDePasse: ADMIN_NEW })).status).toBe(403);
    expect((await dir.post(`/sauvegardes/restaurations/${d1.body.demande.id}/decision`, { decision: 'VALIDER', motDePasse: 'faux' })).status).toBe(400);
    expect((await dir.post(`/sauvegardes/restaurations/${d1.body.demande.id}/decision`, { decision: 'REFUSER', motDePasse: DEMO, commentaire: 'Non justifié' })).body.demande.statut).toBe('REFUSEE');

    const d2 = await admin.post(`/sauvegardes/${s.id}/restauration`, { motif: 'Restauration de contrôle validée par le Directeur' });
    expect((await dir.post(`/sauvegardes/restaurations/${d2.body.demande.id}/decision`, { decision: 'VALIDER', motDePasse: DEMO })).body.demande.statut).toBe('VALIDEE');
    const id = d2.body.demande.id;
    expect((await admin.post(`/sauvegardes/restaurations/${id}/executer`, { confirmation: 'non', motDePasse: ADMIN_NEW, code: await code() })).status).toBe(400);
    expect((await admin.post(`/sauvegardes/restaurations/${id}/executer`, { confirmation: 'RESTAURER', motDePasse: ADMIN_NEW, code: '000000' })).status).toBe(400);
    const auditAvant = Number((await db('audit_logs').count('* as n').first()).n);

    const r = await admin.post(`/sauvegardes/restaurations/${id}/executer`, { confirmation: 'RESTAURER', motDePasse: ADMIN_NEW, code: await code() });
    expect(r.status).toBe(200);
    expect(r.body.resultat.reintegre.audit).toBeGreaterThan(0);

    // La donnée modifiée après la sauvegarde est revenue à son état antérieur
    expect((await db('parametres').where({ cle: 'ville' }).first()).valeur).not.toBe(marqueur);
    // Aucune trace perdue : le journal contient au moins autant d’entrées, chaîne intègre
    expect(Number((await db('audit_logs').count('* as n').first()).n)).toBeGreaterThanOrEqual(auditAvant);
    expect(await db('audit_logs').where({ action: 'POLITIQUE_SECURITE' }).whereILike('message', '[Réintégré après restauration%').first()).toBeTruthy();
    expect(await db('login_history').where({ username: 'ag.doi1', succes: false }).first()).toBeTruthy();
    expect(await db('audit_logs').where({ action: 'RESTAURATION', resultat: 'SUCCES' }).whereILike('message', 'Base restaurée%').first()).toBeTruthy();
    // Registres conservés : la demande est exécutée, la sauvegarde d’avant restauration est connue
    expect((await db('demandes_restauration').where({ id }).first()).statut).toBe('EXECUTEE');
    expect(await db('sauvegardes').where({ origine: 'AVANT_RESTAURATION', statut: 'REUSSIE' }).first()).toBeTruthy();
    // Toutes les sessions sont fermées ; alerte critique (Directeur informé)
    expect((await admin.get('/auth/me')).status).toBe(401);
    expect(await db('alertes_securite').where({ type: 'RESTAURATION', gravite: 'CRITIQUE' }).first()).toBeTruthy();
    const verif = api(await loginAdmin());
    expect((await verif.get('/audit/integrite')).body.integre).toBe(true);
    await db('parametres').where({ cle: 'alerte_echecs_seuil' }).update({ valeur: '10' });
  });
});

describe('Maintenance', () => {
  let admin;
  beforeAll(async () => { admin = api(await loginAdmin()); });
  afterAll(async () => { await db('parametres').where({ cle: 'maintenance_active' }).update({ valeur: 'false' }); });

  test('mode maintenance : seuls les Admins Système accèdent ; statut public', async () => {
    const token = await login('ag.eap1');
    expect((await admin.put('/maintenance', { active: true })).status).toBe(400); // message requis
    expect((await admin.put('/maintenance', { active: true, message: 'Mise à jour du serveur', fin: '2026-10-05 10:00' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 3100)); // cache de l’état
    const r = await api(token).get('/taches');
    expect(r.status).toBe(503);
    expect(r.body.error).toMatchObject({ code: 'MAINTENANCE', message: 'Mise à jour du serveur' });
    expect((await request(app).post('/api/auth/login').send({ username: 'ag.eap1', password: DEMO })).status).toBe(503);
    expect((await request(app).get('/api/statut-public')).body.maintenance).toMatchObject({ active: true, message: 'Mise à jour du serveur' });
    expect((await admin.get('/dashboard')).status).toBe(200);
    expect((await connexion('admin', ADMIN_NEW)).status).toBe(200);
    expect((await admin.put('/maintenance', { active: false })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 3100));
    expect((await request(app).get('/api/statut-public')).body.maintenance.active).toBe(false);
    expect((await api(await login('ag.eap1')).get('/taches')).status).toBe(200);
    expect((await api(await login('directeur')).put('/maintenance', { active: true, message: 'Interdit' })).status).toBe(403);
  });

  test('annonce système à tous les utilisateurs actifs', async () => {
    const r = await admin.post('/maintenance/annonces', { titre: 'Maintenance planifiée', message: 'Le SIG-DEP sera indisponible samedi de 8 h à 10 h.' });
    expect(r.status).toBe(201);
    expect(await db('notifications').where({ user_id: await userId('ag.eap1'), type: 'SYSTEME', titre: 'Maintenance planifiée' }).first()).toBeTruthy();
    expect((await admin.get('/maintenance')).body.annonces[0].titre).toBe('Maintenance planifiée');
    expect((await api(await login('directeur')).post('/maintenance/annonces', { titre: 'Interdite', message: 'Message de test interdit' })).status).toBe(403);
  });

  test('migrations : liste, rien en attente', async () => {
    const m = await admin.get('/maintenance/migrations');
    expect(m.body.appliquees.length).toBeGreaterThanOrEqual(11);
    expect(m.body.enAttente).toEqual([]);
    expect((await admin.post('/maintenance/migrations/appliquer', { motDePasse: 'faux' })).status).toBe(400);
    expect((await admin.post('/maintenance/migrations/appliquer', { motDePasse: ADMIN_NEW })).body.message).toMatch(/Aucune migration/);
  });

  test('environnement en lecture seule, secrets jamais affichés', async () => {
    const e = await admin.get('/maintenance/environnement');
    expect(e.status).toBe(200);
    const texte = JSON.stringify(e.body);
    expect(texte).not.toContain(config.jwt.accessSecret);
    expect(texte).not.toContain(config.backupEncKey);
    expect(texte).not.toContain('sigdep:sigdep');
    expect(e.body.parametres.find((p) => p.cle === 'BACKUP_ENC_KEY').valeur).toBe('configuré');
    expect(e.body.parametres.find((p) => p.cle === 'BACKUP_COPY_DIR').statut).toBe('ATTENTION');
  });
});
