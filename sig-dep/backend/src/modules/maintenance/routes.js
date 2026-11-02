'use strict';
/**
 * Maintenance (Admin Système) : mode maintenance, annonces système à tous les utilisateurs,
 * migrations de la base (avec sauvegarde préalable), paramètres d’environnement en lecture seule.
 */
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../../db/knex');
const config = require('../../config/env');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { alerter } = require('../../services/alertes');
const { notify } = require('../../services/notifications');
const maintenance = require('../../services/maintenance');
const { creerSauvegarde, executer } = require('../../services/sauvegarde');
const { badRequest } = require('../../utils/errors');

const gouvernance = require('../../services/gouvernance');

const router = express.Router();

// ─── Mode maintenance ────────────────────────────────────────────────────────
router.get('/', requirePerm('systeme.consulter'), async (req, res) => {
  res.json({ etat: await maintenance.etat(), annonces: await db('annonces_systeme').orderBy('id', 'desc').limit(20) });
});

router.put('/', requirePerm('systeme.maintenir'), validate({ body: z.object({
  active: z.boolean(), message: z.string().trim().max(500).optional(), fin: z.string().trim().max(40).optional(),
}) }), async (req, res) => {
  const { active, message, fin } = req.valid.body;
  if (active && (!message || message.length < 5)) throw badRequest('Indiquez le message affiché aux utilisateurs pendant la maintenance.');
  const e = await maintenance.definir({ active, message: active ? message : '', fin: active ? fin : '' }, req.ctx.userId);
  await audit(req, { action: active ? 'MAINTENANCE_ACTIVEE' : 'MAINTENANCE_DESACTIVEE', module: 'systeme', message: active ? `${message}${fin ? ` (fin prévue : ${fin})` : ''}` : 'Fin de la maintenance' });
  await alerter({ type: 'MAINTENANCE', gravite: 'ATTENTION', titre: active ? 'Mode maintenance activé' : 'Mode maintenance désactivé', message: `Par ${req.ctx.username}.${active ? ` ${message}` : ''}`, user: { id: req.ctx.userId, username: req.ctx.username } });
  res.json({ etat: e, message: active ? 'Mode maintenance activé : seuls les Admins Système peuvent utiliser l’application.' : 'Mode maintenance désactivé.' });
});

// ─── Annonces système ───────────────────────────────────────────────────────
router.post('/annonces', requirePerm('notification_systeme.envoyer'), validate({ body: z.object({
  titre: z.string().trim().min(5, 'titre trop court').max(150), message: z.string().trim().min(10, 'message trop court').max(2000),
}) }), async (req, res) => {
  const ids = await db('users').where({ statut: 'ACTIF' }).pluck('id');
  const { titre, message } = req.valid.body;
  await notify(ids, { type: 'SYSTEME', titre, message, lien: '/notifications', expediteur: req.ctx.userId });
  await db('annonces_systeme').insert({ titre, message, destinataires: ids.length - 1, envoye_par_username: req.ctx.username });
  await audit(req, { action: 'ANNONCE_SYSTEME', module: 'systeme', message: `${titre} (${ids.length - 1} destinataire(s))` });
  res.status(201).json({ message: `Annonce envoyée à ${ids.length - 1} utilisateur(s).` });
});

// ─── Migrations ──────────────────────────────────────────────────────────────
async function migrations() {
  const [faites, enAttente] = await db.migrate.list();
  const dates = Object.fromEntries((await db('knex_migrations').select('name', 'migration_time')).map((m) => [m.name, m.migration_time]));
  return { appliquees: faites.map((m) => ({ nom: m.name, date: dates[m.name] })), enAttente: enAttente.map((m) => m.file) };
}

router.get('/migrations', requirePerm('systeme.consulter'), async (req, res) => {
  res.json(await migrations());
});

router.post('/migrations/appliquer', requirePerm('systeme.maintenir'), validate({ body: z.object({ motDePasse: z.string().min(1) }) }), async (req, res) => {
  const u = await db('users').where({ id: req.ctx.userId }).first();
  if (!(await bcrypt.compare(req.valid.body.motDePasse, u.password_hash))) throw badRequest('Mot de passe incorrect.');
  const avant = await migrations();
  if (!avant.enAttente.length) return res.json({ message: 'Aucune migration en attente.', ...avant });
  // Opération critique : confirmation préalable du Directeur, pour exactement ces migrations.
  const conf = await gouvernance.exigerConfirmation(req, 'MIGRATIONS', { migrations: avant.enAttente },
    `${avant.enAttente.length} migration(s) : ${avant.enAttente.join(', ')} (sauvegarde préalable automatique)`);
  if (conf.reponse) return res.status(202).json(conf.reponse);
  await gouvernance.consommer(conf.demande);
  let copie; let appliquees;
  try {
    copie = await creerSauvegarde('-avant-migration', { origine: 'AVANT_MIGRATION', user: { id: req.ctx.userId, username: req.ctx.username } });
    [, appliquees] = await db.migrate.latest();
  } catch (e) {
    await gouvernance.restituer(conf.demande);
    throw e;
  }
  await audit(req, { action: 'MIGRATION', module: 'systeme', apres: { appliquees, sauvegarde: copie.fichier }, message: `${appliquees.length} migration(s) appliquée(s) ; sauvegarde préalable ${copie.fichier}` });
  res.json({ message: `${appliquees.length} migration(s) appliquée(s). Sauvegarde préalable : ${copie.fichier}.`, ...(await migrations()) });
});

// ─── Environnement (lecture seule, secrets masqués) ─────────────────────────
async function versionOutil(binaire) {
  try { return (await executer(binaire, ['--version'], process.env, binaire)).trim(); } catch (e) { return null; }
}

router.get('/environnement', requirePerm('systeme.consulter'), async (req, res) => {
  const defini = (v) => (v ? 'configuré' : 'non configuré');
  const secretFaible = /remplacer-par|secret-de-test|changeme/i.test(config.jwt.accessSecret) || config.jwt.accessSecret.length < 32;
  const [pgDump, pgRestore, serveur] = await Promise.all([versionOutil(config.pgDumpPath), versionOutil(config.pgRestorePath), db.raw('show server_version')]);
  const copieOk = config.backupCopyDir ? fs.existsSync(config.backupCopyDir) : false;
  const parametres = [
    { cle: 'NODE_ENV', valeur: config.env },
    { cle: 'PORT', valeur: String(config.port) },
    { cle: 'DATABASE_URL', valeur: defini(config.databaseUrl), secret: true },
    { cle: 'JWT_ACCESS_SECRET', valeur: defini(config.jwt.accessSecret), secret: true, statut: secretFaible ? (config.isProd ? 'CRITIQUE' : 'ATTENTION') : 'OK', conseil: secretFaible ? 'Secret par défaut ou trop court (32 caractères minimum).' : null },
    { cle: 'TOTP_ENC_KEY', valeur: defini(process.env.TOTP_ENC_KEY), secret: true, conseil: process.env.TOTP_ENC_KEY ? null : 'Dérivée de JWT_ACCESS_SECRET (ne pas changer ce secret après la mise en service).' },
    { cle: 'ACCESS_TOKEN_TTL', valeur: config.jwt.accessTtl },
    { cle: 'CORS_ORIGINS', valeur: config.corsOrigins.join(', ') },
    { cle: 'COOKIE_SECURE', valeur: String(config.cookieSecure), statut: config.cookieSecure ? 'OK' : (config.isProd ? 'CRITIQUE' : 'ATTENTION'), conseil: config.cookieSecure ? null : 'À activer en production derrière HTTPS.' },
    { cle: 'UPLOAD_DIR', valeur: config.uploadDir },
    { cle: 'MAX_UPLOAD_MB', valeur: String(Math.round(config.maxUploadBytes / 1048576)) },
    { cle: 'BACKUP_DIR', valeur: config.backupDir },
    { cle: 'BACKUP_COPY_DIR', valeur: config.backupCopyDir || 'non défini', statut: config.backupCopyDir ? (copieOk ? 'OK' : 'CRITIQUE') : 'ATTENTION', conseil: config.backupCopyDir ? (copieOk ? null : 'Emplacement inaccessible.') : 'Aucune copie des sauvegardes hors du serveur.' },
    { cle: 'BACKUP_ENC_KEY', valeur: defini(config.backupEncKey), secret: true, statut: config.backupEncKey ? 'OK' : (config.isProd ? 'CRITIQUE' : 'ATTENTION'), conseil: config.backupEncKey ? 'Conservez la clé hors ligne : sans elle, les sauvegardes sont illisibles.' : 'Sauvegardes non chiffrées.' },
    { cle: 'PG_DUMP_PATH', valeur: config.pgDumpPath, statut: pgDump ? 'OK' : 'CRITIQUE', conseil: pgDump || 'pg_dump introuvable : sauvegardes impossibles.' },
    { cle: 'PG_RESTORE_PATH', valeur: config.pgRestorePath, statut: pgRestore ? 'OK' : 'CRITIQUE', conseil: pgRestore || 'pg_restore introuvable : vérifications et restaurations impossibles.' },
    { cle: 'MAIL_ENABLED', valeur: String(config.mail.enabled), statut: config.mail.enabled ? 'OK' : 'ATTENTION' },
    { cle: 'SMTP_HOST', valeur: config.mail.host },
    { cle: 'SMTP_PASS', valeur: defini(config.mail.pass), secret: true },
    { cle: 'APP_URL', valeur: config.mail.appUrl },
    { cle: 'SEED_DEMO', valeur: String(config.seedDemo) },
  ];
  res.json({ parametres, systeme: { node: process.version, plateforme: `${process.platform} ${process.arch}`, postgresql: serveur.rows[0].server_version } });
});

module.exports = router;
