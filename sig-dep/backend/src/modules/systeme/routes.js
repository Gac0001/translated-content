'use strict';
/** Administration technique : état du système, paramètres généraux, sauvegardes PostgreSQL. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const db = require('../../db/knex');
const config = require('../../config/env');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const mailer = require('../../services/mailer');
const bcrypt = require('bcrypt');
const { creerSauvegarde } = require('../../services/sauvegarde');
const reinit = require('../../services/reinitialisation');
const { alerter } = require('../../services/alertes');
const { notFound, badRequest, AppError } = require('../../utils/errors');

const router = express.Router();

// Paramètres lisibles par tout utilisateur authentifié (en-têtes, libellés)
router.get('/parametres/publics', async (req, res) => {
  const rows = await db('parametres').whereIn('cle', ['pays', 'autorite_tutelle', 'direction_nom', 'direction_sigle', 'ville']);
  res.json(Object.fromEntries(rows.map((r) => [r.cle, r.valeur])));
});

router.get('/etat', requirePerm('systeme.consulter'), async (req, res) => {
  const t0 = Date.now();
  await db.raw('select 1');
  const latence = Date.now() - t0;
  const [version, size, migrations, counts] = await Promise.all([
    db.raw('select version()'), db.raw('select pg_size_pretty(pg_database_size(current_database())) as taille'),
    db('knex_migrations').orderBy('id'),
    db.raw(`select (select count(*) from users) as comptes, (select count(*) from agents) as agents, (select count(*) from audit_logs) as audit,
      (select count(*) from attachments where deleted_at is null) as pieces, (select coalesce(sum(size_bytes),0) from attachments) as octets`),
  ]);
  let backups = [];
  try { backups = fs.readdirSync(config.backupDir).filter((f) => f.endsWith('.sql') || f.endsWith('.dump')); } catch (e) { /* ignore */ }
  res.json({
    api: { statut: 'Opérationnelle', node: process.version, uptimeSecondes: Math.round(process.uptime()), memoireMo: Math.round(process.memoryUsage().rss / 1048576), environnement: config.env },
    baseDeDonnees: { statut: 'Opérationnelle', latenceMs: latence, version: version.rows[0].version.split(',')[0], taille: size.rows[0].taille, migrations: migrations.map((m) => m.name) },
    stockage: { piecesJointes: Number(counts.rows[0].pieces), volumeMo: Math.round(Number(counts.rows[0].octets) / 1048576 * 10) / 10, sauvegardes: backups.length },
    volumes: counts.rows[0],
  });
});

// Paramètres gérés par des écrans dédiés (politique de sécurité) ou internes : non modifiables ici.
const CLES_RESERVEES = (cle) => /^(mdp_|verrouillage_|session_|inactivite_|alerte_|regles_|audit_|securite_)/.test(cle) || cle === 'donnees_demo';

router.get('/parametres', requirePerm('systeme.configurer'), async (req, res) => {
  res.json({ data: (await db('parametres').orderBy('cle')).filter((p) => !CLES_RESERVEES(p.cle)) });
});

router.put('/parametres/:cle', requirePerm('systeme.configurer'), validate({ params: z.object({ cle: z.string().max(80) }), body: z.object({ valeur: z.string().max(2000) }) }), async (req, res) => {
  const before = await db('parametres').where({ cle: req.valid.params.cle }).first();
  if (!before) throw notFound('Paramètre inconnu.');
  if (CLES_RESERVEES(before.cle)) throw badRequest('Ce paramètre se règle depuis l’écran Sécurité (politique) ou est interne au système.');
  if (req.valid.params.cle === 'direction_nom' && req.valid.body.valeur !== 'Direction d’Études et Planification') {
    throw badRequest('L’appellation officielle « Direction d’Études et Planification » ne peut pas être modifiée.');
  }
  await db('parametres').where({ cle: before.cle }).update({ valeur: req.valid.body.valeur, updated_at: db.fn.now(), updated_by: req.ctx.userId });
  await audit(req, { action: 'MODIFICATION', module: 'systeme', entite: 'parametre', entiteId: before.cle, avant: { valeur: before.valeur }, apres: req.valid.body });
  res.json({ message: 'Paramètre enregistré.' });
});

router.get('/sauvegardes', requirePerm('sauvegarde.creer'), async (req, res) => {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const files = fs.readdirSync(config.backupDir).filter((f) => /\.(sql|dump)$/.test(f)).map((f) => {
    const st = fs.statSync(path.join(config.backupDir, f));
    return { fichier: f, tailleOctets: st.size, date: st.mtime };
  }).sort((a, b) => b.date - a.date);
  res.json({ data: files, repertoire: config.backupDir });
});

router.post('/sauvegardes', requirePerm('sauvegarde.creer'), async (req, res) => {
  const r = await creerSauvegarde().catch(async (e) => {
    await audit(req, { action: 'SAUVEGARDE', module: 'systeme', resultat: 'ECHEC', message: e.message });
    throw e;
  });
  await audit(req, { action: 'SAUVEGARDE', module: 'systeme', message: `${r.fichier} (${r.tailleOctets} octets)` });
  res.status(201).json({ ...r, message: 'Sauvegarde réalisée.' });
});

router.get('/sauvegardes/:fichier', requirePerm('sauvegarde.creer'), validate({ params: z.object({ fichier: z.string().regex(/^sig-dep-[0-9T-]+(-[a-z]+)?\.(dump|sql)$/) }) }), async (req, res) => {
  const p = path.join(config.backupDir, req.valid.params.fichier);
  if (!fs.existsSync(p)) throw notFound('Sauvegarde introuvable.');
  await audit(req, { action: 'EXPORT', module: 'systeme', message: `Téléchargement de la sauvegarde ${req.valid.params.fichier}` });
  res.download(p);
});

// ─── Messagerie (notifications par e-mail) ──────────────────────────────────
router.get('/messagerie', requirePerm('systeme.configurer'), async (req, res) => {
  const m = config.mail;
  const stats = await db('email_outbox').select('statut').count('* as n').groupBy('statut');
  const envoyes24 = await db('email_outbox').where('statut', 'ENVOYE').where('sent_at', '>', db.raw(`now() - interval '24 hours'`)).count('* as n').first();
  const recents = await db('email_outbox').orderBy('id', 'desc').limit(30)
    .select('id', 'to_email', 'subject', 'type', 'statut', 'tentatives', 'derniere_erreur', 'prochain_essai', 'sent_at', 'created_at');
  const sansAdresse = await db('users as u').leftJoin('agents as a', 'a.id', 'u.agent_id')
    .where('u.statut', 'ACTIF').whereNotNull('u.agent_id').where((w) => w.whereNull('a.email').orWhere('a.email', '')).count('* as n').first();
  res.json({
    configuration: {
      active: m.enabled, transport: m.transport, serveur: m.transport === 'smtp' ? `${m.host}:${m.port}` : null,
      securite: m.secure ? 'TLS implicite' : 'STARTTLS si disponible', authentification: !!m.user, expediteur: m.from, adresseApplication: m.appUrl, tentativesMax: m.maxAttempts,
    },
    file: Object.fromEntries(stats.map((x) => [x.statut, Number(x.n)])),
    envoyes24h: Number(envoyes24.n),
    comptesSansAdresse: Number(sansAdresse.n),
    recents,
  });
});

router.post('/messagerie/verifier', requirePerm('systeme.configurer'), async (req, res) => {
  res.json(await mailer.verifyConnection());
});

router.post('/messagerie/test', requirePerm('systeme.configurer'), validate({ body: z.object({ destinataire: z.email('adresse électronique invalide') }) }), async (req, res) => {
  if (!config.mail.enabled) throw badRequest('La messagerie est désactivée (MAIL_ENABLED=false dans le fichier .env).');
  try {
    await mailer.sendTest(req.valid.body.destinataire);
  } catch (e) {
    await audit(req, { action: 'EMAIL_TEST', module: 'systeme', resultat: 'ECHEC', message: `${req.valid.body.destinataire} : ${e.message}` });
    throw new AppError(502, 'SMTP_ECHEC', `Échec de l’envoi : ${e.message}`);
  }
  await audit(req, { action: 'EMAIL_TEST', module: 'systeme', message: req.valid.body.destinataire });
  res.json({ message: `E-mail de test envoyé à ${req.valid.body.destinataire}.` });
});

router.post('/messagerie/relancer', requirePerm('systeme.configurer'), async (req, res) => {
  const n = await db('email_outbox').where('statut', 'ECHEC').update({ statut: 'EN_ATTENTE', tentatives: 0, prochain_essai: db.fn.now() });
  await audit(req, { action: 'MODIFICATION', module: 'systeme', message: `Relance de ${n} e-mail(s) en échec` });
  res.json({ message: `${n} e-mail(s) remis en file d’envoi.`, relances: n });
});

router.post('/messagerie/traiter', requirePerm('systeme.configurer'), async (req, res) => {
  res.json(await mailer.processOutbox(100));
});

// ─── Réinitialisation de la base (mise en service) ──────────────────────────
router.get('/reinitialisation', requirePerm('systeme.maintenir'), async (req, res) => {
  const [volumes, demo] = await Promise.all([reinit.volumes(), reinit.donneesDemo()]);
  res.json({ donneesDemo: demo, volumes, conservees: ['organigramme (Divisions, Bureaux, postes, attributions)', 'grades et fonctions', 'rôles et permissions', 'paramètres', 'compte Admin'] });
});

const PHRASE = 'REINITIALISER';
router.post('/reinitialisation', requirePerm('systeme.maintenir'), validate({
  body: z.object({
    mode: z.enum(['VIERGE', 'DEMO'], { message: 'mode invalide' }),
    confirmation: z.string().trim(),
    motDePasse: z.string().min(1, 'mot de passe requis'),
    sauvegarde: z.boolean().default(true),
  }),
}), async (req, res) => {
  const { mode, confirmation, motDePasse, sauvegarde } = req.valid.body;
  if (confirmation.toUpperCase() !== PHRASE) throw badRequest(`Saisissez « ${PHRASE} » pour confirmer.`);
  const me = await db('users').where({ id: req.ctx.userId }).first();
  if (!(await bcrypt.compare(motDePasse, me.password_hash))) {
    await audit(req, { action: 'REINITIALISATION', module: 'systeme', resultat: 'ECHEC', message: 'Mot de passe incorrect' });
    throw badRequest('Mot de passe incorrect.');
  }
  let copie = null;
  if (sauvegarde) {
    copie = await creerSauvegarde('-avant-reinitialisation').catch(async (e) => {
      await audit(req, { action: 'REINITIALISATION', module: 'systeme', resultat: 'ECHEC', message: `Sauvegarde préalable impossible : ${e.message}` });
      throw new AppError(e.status || 500, e.code || 'SAUVEGARDE_ECHEC', `${e.message} Réinitialisation annulée : décochez la sauvegarde préalable seulement si une sauvegarde a été faite par ailleurs.`);
    });
  }
  const r = await reinit.reinitialiser({ mode, adminId: req.ctx.userId });
  await alerter({ type: 'REINITIALISATION', gravite: 'CRITIQUE', titre: mode === 'DEMO' ? 'Base réinitialisée avec les données fictives' : 'Base réinitialisée (base vierge)', message: `Par ${req.ctx.username}. Sauvegarde préalable : ${copie ? copie.fichier : 'aucune'}.`, user: { id: req.ctx.userId, username: req.ctx.username }, ip: req.ip });
  await audit(req, {
    action: 'REINITIALISATION', module: 'systeme', avant: r.avant, apres: { ...r.apres, mode, sauvegarde: copie && copie.fichier },
    message: mode === 'DEMO' ? 'Réinitialisation de la base avec données fictives de démonstration' : 'Réinitialisation de la base (base vierge pour la mise en service)',
  });
  res.json({
    mode, sauvegarde: copie, volumes: r.apres,
    message: mode === 'DEMO'
      ? 'Base réinitialisée avec les données fictives de démonstration.'
      : 'Base vierge : créez le compte du Directeur, qui importera et validera la liste officielle des agents.',
  });
});

module.exports = router;
